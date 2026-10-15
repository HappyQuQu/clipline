import os
import subprocess
import threading
from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Artifact, Segment
from app.db.transactions import write_session
from app.services import media, playback
from app.services.timeline import local_day
from app.tasks.queue import Queue
from app.worker import execute


@pytest.fixture
def indexed(client, config, database, put_video):
    file = put_video(config.recordings_root / "alpha")
    source = client.post(
        "/api/sources",
        json={
            "name": "Alpha",
            "path": str(file.parent),
            "scanOnCreate": True,
            "scanIntervalMinutes": None,
        },
    ).json()["source"]
    queue = Queue(database, config, "test")
    execute(queue, queue.claim(), threading.Event())
    segment = client.get("/api/segments", params={"sourceId": source["id"]}).json()["items"][0]
    return source, segment, file


def submit(client, segment, force=True, key=None):
    response = client.post(
        f"/api/segments/{segment['id']}/prepare",
        json={"force": force},
        headers={"Idempotency-Key": key} if key else {},
    )
    assert response.status_code == 202, response.text
    return response.json()


def perform(config, database):
    queue = Queue(database, config, "test")
    claim = queue.claim()
    assert claim
    execute(queue, claim, threading.Event())
    return claim


@pytest.mark.parametrize(
    "value,code",
    [
        ("bytes=0-15", 206),
        ("bytes=2-", 206),
        ("bytes=-10", 206),
        ("bytes=0-99999999", 206),
        ("bytes=99999999-", 416),
        ("bytes=5-2", 416),
        ("bytes=-0", 416),
        ("bytes=0-1,3-4", 416),
        ("items=0-3", 416),
    ],
)
def test_original_ranges(client, indexed, value, code):
    _, segment, file = indexed
    url = client.get(f"/api/segments/{segment['id']}/playback").json()["mediaUrl"]
    response = client.get(url, headers={"Range": value})
    assert response.status_code == code
    assert response.headers["accept-ranges"] == "bytes"
    if code == 206:
        assert int(response.headers["content-length"]) == len(response.content)
        start, end = map(int, response.headers["content-range"].split()[1].split("/")[0].split("-"))
        assert response.content == file.read_bytes()[start : end + 1]
    else:
        assert response.headers["content-range"] == f"bytes */{file.stat().st_size}"


def test_head_etag_if_range_no_audio_and_already_direct(client, indexed):
    _, segment, file = indexed
    state = client.get(f"/api/segments/{segment['id']}/playback").json()
    assert state["status"] == "direct" and not state["proxy"]
    head = client.head(state["mediaUrl"], headers={"Range": "bytes=0-10"})
    assert head.status_code == 200 and not head.content
    assert int(head.headers["content-length"]) == file.stat().st_size
    assert (
        client.get(state["mediaUrl"], headers={"If-None-Match": head.headers["etag"]}).status_code
        == 304
    )
    assert (
        client.get(
            state["mediaUrl"], headers={"If-Range": "old", "Range": "bytes=0-10"}
        ).status_code
        == 200
    )
    assert submit(client, segment, force=False)["taskId"] is None


def test_file_replacement_symlink_escape_and_fingerprint_rejected(client, config, indexed):
    _, segment, file = indexed
    assert client.get(f"/api/segments/{segment['id']}/media?fingerprint=old").status_code == 409
    outside = config.data / "private.mp4"
    outside.write_bytes(file.read_bytes())
    file.unlink()
    file.symlink_to(outside)
    assert client.get(f"/api/segments/{segment['id']}/playback").status_code == 403
    file.unlink()
    file.write_bytes(b"changed")
    assert client.get(f"/api/segments/{segment['id']}/playback").status_code == 409


def test_proxy_dedup_publication_cached_range_and_disabled_source(
    client, config, database, indexed
):
    source, segment, file = indexed
    before = file.read_bytes()
    client.patch(f"/api/sources/{source['id']}", json={"enabled": False})
    first, duplicate = submit(client, segment, key="one"), submit(client, segment, key="two")
    assert first["taskId"] == duplicate["taskId"] and duplicate["reused"]
    assert (
        client.post(
            f"/api/segments/{segment['id']}/prepare",
            json={"force": False},
            headers={"Idempotency-Key": "one"},
        ).status_code
        == 409
    )
    perform(config, database)
    done = client.get("/api/tasks/" + first["taskId"]).json()
    assert done["status"] == "completed", done
    state = client.get(f"/api/segments/{segment['id']}/playback").json()
    assert state["status"] == "ready" and state["proxy"]
    response = client.get(state["mediaUrl"], headers={"Range": "bytes=0-99"})
    assert response.status_code == 206 and len(response.content) == 100
    with Session(database) as session:
        artifact = session.scalar(select(Artifact).where(Artifact.kind == "playback"))
        assert artifact.status == "ready" and artifact.duration_ms == 1000
    assert submit(client, segment, key="after")["taskId"] is None
    assert submit(client, segment, key="two")["taskId"] == first["taskId"]
    assert file.read_bytes() == before
    assert not list((config.data / "tmp" / first["taskId"]).glob("*"))


def test_prepare_lock_independent_from_scan_cancel_retry_new_id(client, config, database, indexed):
    source, segment, _ = indexed
    client.post("/api/tasks", json={"sourceId": source["id"], "kind": "reindex"})
    queued = submit(client, segment)
    queue = Queue(database, config, "test")
    first, second = queue.claim(), queue.claim()
    assert {first.kind, second.kind} == {"prepare", "reindex"}
    client.post("/api/tasks/" + queued["taskId"] + "/cancel")
    execute(queue, first if first.kind == "prepare" else second, threading.Event())
    assert client.get("/api/tasks/" + queued["taskId"]).json()["status"] == "cancelled"
    retry = client.post("/api/tasks/" + queued["taskId"] + "/retry", json={}).json()
    assert retry["taskId"] != queued["taskId"]
    assert client.get("/api/tasks/" + retry["taskId"]).json()["retryOfTaskId"] == queued["taskId"]


@pytest.mark.parametrize("failure", ["capacity", "corrupt", "cancel", "changed"])
def test_proxy_never_publishes_invalid_cancelled_or_stale_output(
    client, config, database, indexed, monkeypatch, failure
):
    _, segment, file = indexed
    queued = submit(client, segment)
    if failure == "capacity":
        config.playback_cache_max_bytes = 1
    elif failure == "corrupt":
        monkeypatch.setattr(
            media, "make_proxy", lambda path, length, target, context: target.write_bytes(b"bad")
        )
    elif failure == "cancel":
        original = playback.prepare

        def cancelled(context):
            result = original(context)
            client.post("/api/tasks/" + queued["taskId"] + "/cancel")
            return result

        monkeypatch.setattr("app.worker.prepare", cancelled)
    else:
        original = media.make_proxy

        def changed(path, length, target, context):
            original(path, length, target, context)
            os.utime(file, ns=(file.stat().st_atime_ns, file.stat().st_mtime_ns + 100))

        monkeypatch.setattr(media, "make_proxy", changed)
    perform(config, database)
    done = client.get("/api/tasks/" + queued["taskId"]).json()
    assert done["status"] == ("cancelled" if failure == "cancel" else "failed"), done
    with Session(database) as session:
        assert not list(
            session.scalars(
                select(Artifact).where(Artifact.kind == "playback", Artifact.status == "ready")
            )
        )
    assert not list((config.data / "playback-proxies").glob("*.mp4"))


def test_timeline_union_cross_day_resolve_gap_window_cursor_dst(client, database, indexed):
    source, base, _ = indexed
    start, _ = local_day(date(2026, 10, 13), "Asia/Shanghai")
    with write_session(database) as session:
        session.get(Segment, base["id"]).availability = "missing"
        for key, left, right in [
            ("a", -5000, 5000),
            ("b", 3000, 10000),
            ("c", 20000, 30000),
            ("d", 20000, 25000),
        ]:
            session.add(
                Segment(
                    id=key,
                    source_id=source["id"],
                    relative_path=key + ".mp4",
                    filename=key + ".mp4",
                    size_bytes=1,
                    mtime_ns=1,
                    fingerprint=key,
                    start_at=start + left,
                    end_at=start + right,
                    duration_ms=right - left,
                    availability="available",
                )
            )
    assert client.get(f"/api/sources/{source['id']}/dates").json()["items"] == [
        "2026-10-13",
        "2026-10-12",
    ]
    params = {
        "sourceId": source["id"],
        "date": "2026-10-13",
        "startSeconds": 0,
        "endSeconds": 15,
        "limit": 1,
    }
    result = client.get("/api/timeline", params=params).json()
    assert result["coverageMs"] == 20000 and result["segmentCount"] == 4
    assert result["items"][0]["id"] == "a" and len(result["coverage"]) == 2
    assert (
        client.get("/api/timeline", params=params | {"cursor": result["nextCursor"]}).json()[
            "items"
        ][0]["id"]
        == "b"
    )
    assert (
        client.get(
            "/api/timeline", params=params | {"cursor": result["nextCursor"], "endSeconds": 30}
        ).status_code
        == 422
    )
    descending = params | {"endSeconds": 30, "order": "desc", "limit": 2}
    newest = client.get("/api/timeline", params=descending).json()
    assert [row["id"] for row in newest["items"]] == ["d", "c"]
    older = client.get("/api/timeline", params=descending | {"cursor": newest["nextCursor"]}).json()
    assert [row["id"] for row in older["items"]] == ["b", "a"]
    assert older["nextCursor"] is None
    assert newest["coverage"] == result["coverage"] and newest["gaps"] == result["gaps"]
    assert (
        client.get(
            "/api/timeline", params=descending | {"cursor": newest["nextCursor"], "order": "asc"}
        ).status_code
        == 422
    )
    found = client.get(
        f"/api/sources/{source['id']}/resolve", params={"at": "2026-10-13T00:00:04+08:00"}
    ).json()
    assert found["segment"]["id"] == "a" and found["offsetMs"] == 9000
    next_part = client.get(
        f"/api/sources/{source['id']}/resolve", params={"at": "2026-10-13T00:00:05+08:00"}
    ).json()
    assert next_part["segment"]["id"] == "b" and next_part["offsetMs"] == 2000
    gap = client.get(
        f"/api/sources/{source['id']}/resolve", params={"at": "2026-10-13T00:00:10+08:00"}
    ).json()
    assert gap["status"] == "gap" and gap["nextAt"] == "2026-10-12T16:00:20.000Z"
    assert (
        client.get(
            f"/api/sources/{source['id']}/resolve", params={"at": "2026-10-13T00:00:10"}
        ).status_code
        == 422
    )
    for day, length in [(date(2026, 3, 8), 23), (date(2026, 11, 1), 25)]:
        a, b = local_day(day, "America/New_York")
        assert b - a == length * 3600 * 1000


def test_explicit_manual_source_interval_is_stored_as_sql_null(client, config):
    response = client.post(
        "/api/sources",
        json={
            "name": "Manual",
            "path": str(config.recordings_root / "alpha"),
            "scanIntervalMinutes": None,
            "scanOnCreate": False,
        },
    )
    assert response.status_code == 201
    assert response.json()["source"]["scanIntervalMinutes"] is None
    assert client.get("/api/sources").json()["items"][0]["nextScanAt"] is None


@pytest.fixture
def indexed_hevc(client, config, database):
    path = config.recordings_root / "alpha" / "20261013_091500.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:r=10",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440",
            "-t",
            "4",
            "-c:v",
            "libx265",
            "-x265-params",
            "pools=none:frame-threads=1:log-level=error",
            "-threads",
            "1",
            "-tag:v",
            "hvc1",
            "-c:a",
            "libopus",
            "-y",
            str(path),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    os.utime(path, (1_700_000_000, 1_700_000_000))
    source = client.post(
        "/api/sources",
        json={
            "name": "HEVC",
            "path": str(path.parent),
            "scanOnCreate": True,
            "scanIntervalMinutes": None,
        },
    ).json()["source"]
    perform(config, database)
    segment = client.get("/api/segments", params={"sourceId": source["id"]}).json()["items"][0]
    assert segment["videoCodec"] == "hevc" and segment["audioCodec"] == "opus"
    return source, segment, path


def test_hevc_native_cold_playback_no_task_or_proxy_and_source_guards(
    client,
    config,
    database,
    indexed_hevc,
):
    _, segment, path = indexed_hevc
    before = path.read_bytes()
    endpoint = f"/api/segments/{segment['id']}"
    legacy = client.get(endpoint + "/playback").json()
    assert legacy["status"] == "needs_prepare"
    native = client.get(endpoint + "/playback?mode=original").json()
    assert native["status"] == "direct" and not native["proxy"]
    assert native["mode"] == "original" and native["taskId"] is None
    assert (
        client.get(native["mediaUrl"], headers={"Range": "bytes=0-1023"}).content == before[:1024]
    )
    assert client.head(native["mediaUrl"]).headers["content-length"] == str(len(before))
    assert client.post(endpoint + "/prepare", json={"mode": "original"}).json()["taskId"] is None
    assert not list((config.data / "playback-proxies").glob("*.mp4"))
    with Session(database) as session:
        from app.db.models import Task

        assert not list(session.scalars(select(Task).where(Task.kind == "prepare")))
    os.utime(path, ns=(path.stat().st_atime_ns, path.stat().st_mtime_ns + 1))
    assert client.get(native["mediaUrl"]).status_code == 409


def test_hevc_audio_remux_preserves_video_and_keeps_h264_fallback_cache(
    client,
    config,
    database,
    indexed_hevc,
):
    _, segment, path = indexed_hevc
    before = path.read_bytes()
    endpoint = f"/api/segments/{segment['id']}"
    first = client.post(endpoint + "/prepare", json={"mode": "hevc"}).json()
    duplicate = client.post(endpoint + "/prepare", json={"mode": "hevc"}).json()
    assert first["taskId"] == duplicate["taskId"] and duplicate["reused"]
    perform(config, database)
    done = client.get("/api/tasks/" + first["taskId"]).json()
    assert done["status"] == "completed", done
    state = client.get(endpoint + "/playback?mode=hevc").json()
    assert state["status"] == "ready" and state["mode"] == "hevc"
    assert client.get(endpoint + "/playback").json()["status"] == "needs_prepare"
    assert client.get(state["mediaUrl"], headers={"Range": "bytes=0-255"}).status_code == 206
    with Session(database) as session:
        row = session.get(Segment, segment["id"])
        artifact, output = playback.cached(session, config, row, "hevc")
        assert artifact.duration_ms == pytest.approx(segment["durationMs"], abs=100)
        import json

        info = json.loads(
            subprocess.check_output(
                ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(output)]
            )
        )["streams"]
        assert info[0]["codec_name"] == "hevc" and info[0]["codec_tag_string"] == "hvc1"
        assert info[0]["width"] == 160 and info[1]["codec_name"] == "aac"

        def video_hash(file):
            return subprocess.check_output(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-i",
                    str(file),
                    "-map",
                    "0:v:0",
                    "-c:v",
                    "copy",
                    "-f",
                    "hash",
                    "-hash",
                    "sha256",
                    "-",
                ]
            )

        assert video_hash(path) == video_hash(output)
    lease = client.post(
        endpoint + "/lease?mode=hevc", json={"clientId": "10000000-0000-4000-8000-000000000001"}
    ).json()
    assert lease["leased"]
    fallback = submit(client, segment)
    perform(config, database)
    assert client.get("/api/tasks/" + fallback["taskId"]).json()["status"] == "completed"
    assert client.get(endpoint + "/playback").json()["status"] == "ready"
    assert client.get(endpoint + "/playback?mode=hevc").json()["status"] == "ready"
    assert path.read_bytes() == before


def test_hevc_cancel_retry_retains_mode(client, config, database, indexed_hevc):
    _, segment, _ = indexed_hevc
    endpoint = f"/api/segments/{segment['id']}"
    queued = client.post(endpoint + "/prepare", json={"mode": "hevc"}).json()
    client.post("/api/tasks/" + queued["taskId"] + "/cancel")
    # Queued cancellation is immediate; retry keeps the low-cost profile.
    retry = client.post("/api/tasks/" + queued["taskId"] + "/retry", json={}).json()
    perform(config, database)
    done = client.get("/api/tasks/" + retry["taskId"]).json()
    assert done["status"] == "completed", done
    assert done["payload"]["mode"] == "hevc"
    assert client.get(endpoint + "/playback?mode=hevc").json()["status"] == "ready"


def test_hevc_mode_does_not_bypass_non_hevc_incompatibility(client, indexed):
    _, segment, _ = indexed
    endpoint = f"/api/segments/{segment['id']}"
    assert client.get(endpoint + "/playback?mode=original").json()["mode"] == "compatible"
    assert client.get(endpoint + "/playback?mode=unknown").status_code == 422
    assert client.post(endpoint + "/prepare", json={"mode": "unknown"}).status_code == 422
