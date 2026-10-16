import json
import os
import subprocess
import threading
import time
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utc_now_ms
from app.db.models import Artifact
from app.db.transactions import write_session
from app.services import exports
from app.tasks.context import TaskContext
from app.tasks.queue import Queue
from app.worker import execute


@pytest.fixture
def archive(client, config, database):
    paths = []
    for index, color in enumerate(("red", "blue", "green")):
        path = config.recordings_root / "alpha" / f"20261013_09150{index * 3}.mp4"
        args = [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s=160x90:r=25",
        ]
        if index != 2:
            args += ["-f", "lavfi", "-i", f"sine=frequency={440 + index * 440}:sample_rate=48000"]
        args += [
            "-t",
            "2",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-g",
            "25",
            "-bf",
            "0",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-y",
            str(path),
        ]
        subprocess.run(args, check=True, capture_output=True)
        os.utime(path, (time.time() - 120, time.time() - 120))
        paths.append(path)
    source = client.post(
        "/api/sources",
        json={
            "name": "Export",
            "path": str(paths[0].parent),
            "scanOnCreate": True,
            "scanIntervalMinutes": None,
        },
    ).json()["source"]
    perform(config, database)
    segments = sorted(
        client.get("/api/segments", params={"sourceId": source["id"]}).json()["items"],
        key=lambda row: row["startAt"],
    )
    return source, segments, paths


def perform(config, database):
    queue = Queue(database, config, "test")
    claim = queue.claim()
    assert claim
    execute(queue, claim, threading.Event())
    return claim


def body(archive, mode="precise", end=7.5):
    source, rows, _ = archive
    start = datetime.fromisoformat(rows[0]["startAt"])
    return {
        "sourceId": source["id"],
        "date": "2026-10-13",
        "startAt": (start + timedelta(seconds=0.5)).isoformat(),
        "endAt": (start + timedelta(seconds=end)).isoformat(),
        "mode": mode,
        "name": "中文录像.mp4",
    }


def enqueue(client, data, key=None):
    response = client.post(
        "/api/exports", json=data, headers={"Idempotency-Key": key} if key else {}
    )
    assert response.status_code == 202, response.text
    return response.json()["taskId"]


def task(client, id):
    return client.get("/api/tasks/" + id).json()


def test_plan_gap_selection_overlap_and_invalid_ranges(client, config, database, archive):
    data = body(archive)
    plan = client.post("/api/exports/plan", json=data).json()
    assert plan["pieceCount"] == 3 and plan["expectedDurationMs"] == 5000
    assert plan["unrecordedMs"] == 2000 and plan["omittedMs"] == 0
    selected = client.post(
        "/api/exports/plan", json=data | {"segmentIds": [archive[1][0]["id"], archive[1][2]["id"]]}
    ).json()
    assert selected["expectedDurationMs"] == 3000 and selected["omittedMs"] == 2000
    for override in (
        {"endAt": data["startAt"]},
        {"endAt": "2026-10-20T09:15:01+08:00"},
        {"segmentIds": []},
        {"segmentIds": ["missing"]},
        {"startAt": "2026-10-13T10:00:00", "endAt": "2026-10-13T10:01:00"},
    ):
        assert client.post("/api/exports/plan", json=data | override).status_code == 422
    assert client.post("/api/exports", json=data | {"planHash": "0" * 64}).status_code == 409
    from app.db.models import Segment

    with write_session(database) as session:
        row = session.get(Segment, archive[1][1]["id"])
        row.start_at -= 1500
        row.end_at -= 1500
    overlap = client.post("/api/exports/plan", json=data).json()
    assert overlap["expectedDurationMs"] == 4500  # First overlap is not duplicated.


def test_seven_day_export_limits_cross_day_gaps_and_real_download(
    client, config, database, archive
):
    from app.db.models import Segment

    start = datetime.fromisoformat(archive[1][0]["startAt"])
    before = [path.read_bytes() for path in archive[2]]
    # Short real fixtures on three separate dates exercise a full seven-day plan cheaply.
    with write_session(database) as session:
        for offset, item in zip((0, 1, 6), archive[1], strict=True):
            row = session.get(Segment, item["id"])
            row.start_at = int((start + timedelta(days=offset)).timestamp() * 1000)
            row.end_at = row.start_at + row.duration_ms
    data = body(archive) | {
        "startAt": start.isoformat(),
        "endAt": (start + timedelta(days=7)).isoformat(),
    }
    preview = client.post("/api/exports/plan", json=data)
    assert preview.status_code == 200, preview.text
    plan = preview.json()
    assert plan["pieceCount"] == 3 and plan["selectedCoverageMs"] == 6000
    assert plan["unrecordedMs"] == 7 * 86400_000 - 6000
    for endpoint in ("/api/exports/plan", "/api/exports"):
        response = client.post(
            endpoint, json=data | {"endAt": (start + timedelta(days=7, milliseconds=1)).isoformat()}
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "EXPORT_RANGE_TOO_LARGE"
        assert "7 天" in response.json()["error"]["message"]
    wrong_date = client.post("/api/exports/plan", json=data | {"date": "2026-10-12"})
    assert wrong_date.json()["error"]["code"] == "INVALID_EXPORT_RANGE"
    identifier = enqueue(client, data)
    perform(config, database)
    done = task(client, identifier)
    assert done["status"] == "completed", done
    assert (
        done["result"]["pieceCount"] == 3 and abs(done["result"]["actualDurationMs"] - 6000) <= 40
    )
    download = client.get(done["result"]["downloadUrl"])
    assert download.status_code == 200 and len(download.content) == done["result"]["sizeBytes"]
    assert [path.read_bytes() for path in archive[2]] == before


def test_export_settings_allow_seven_days_but_reject_bypassing_cap(client):
    export = client.get("/api/settings").json()["groups"]["export"]
    assert export["values"]["maxDuration"] == 10080
    for limit in (10081, 20160, True, "10080"):
        response = client.patch(
            "/api/settings/export",
            json={
                "revision": export["revision"],
                "values": {"defaultMode": "fast", "maxDuration": limit},
            },
        )
        assert response.status_code == 422
    assert (
        client.patch(
            "/api/settings/export",
            json={
                "revision": export["revision"],
                "values": {"defaultMode": "fast", "maxDuration": 10080},
            },
        ).status_code
        == 200
    )


def test_precise_mixed_audio_frames_download_range_expiry_and_resubmit(
    client, config, database, archive
):
    data = body(archive)
    before = [path.read_bytes() for path in archive[2]]
    id = enqueue(client, data, "one")
    assert enqueue(client, data, "two") == id
    assert client.get(f"/api/exports/{id}/download").status_code == 409
    perform(config, database)
    done = task(client, id)
    assert done["status"] == "completed", done
    result = done["result"]
    assert (
        result["frameCount"] == 125
        and result["videoCodec"] == "h264"
        and result["audioCodec"] == "aac"
    )
    assert abs(result["actualDurationMs"] - 5000) <= 40
    assert result["pieceCount"] == 3 and result["unrecordedMs"] == 2000
    url = result["downloadUrl"]
    whole = client.get(url)
    assert whole.status_code == 200 and len(whole.content) == result["sizeBytes"]
    assert "filename*=UTF-8''%" in whole.headers["content-disposition"]
    assert client.head(url).headers["content-length"] == str(len(whole.content))
    assert client.get(url, headers={"Range": "bytes=0-99"}).content == whole.content[:100]
    assert client.get(url, headers={"Range": "bytes=-10"}).content == whole.content[-10:]
    assert client.get(url, headers={"Range": "bytes=0-1,3-4"}).status_code == 416
    assert client.get(url, headers={"If-None-Match": whole.headers["etag"]}).status_code == 304
    assert enqueue(client, data, "two") == id  # Completed idempotency alias remains durable.
    assert [path.read_bytes() for path in archive[2]] == before
    # Check color boundaries and silence for absent audio, using the actual downloaded file.
    output = config.data / "download-test.mp4"
    output.write_bytes(whole.content)
    for offset, channel in ((0.4, 0), (2, 2), (4, 1)):
        pixel = subprocess.check_output(
            [
                "ffmpeg",
                "-v",
                "error",
                "-ss",
                str(offset),
                "-i",
                str(output),
                "-frames:v",
                "1",
                "-vf",
                "scale=1:1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-",
            ]
        )
        assert pixel[channel] > max(pixel[(channel + 1) % 3], pixel[(channel + 2) % 3]) * 2
    raw = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-ss",
            "4.1",
            "-i",
            str(output),
            "-t",
            "0.5",
            "-vn",
            "-ac",
            "1",
            "-f",
            "s16le",
            "-",
        ]
    )
    import array

    samples = array.array("h", raw)
    assert max(abs(value) for value in samples) < 10
    with write_session(database) as session:
        artifact = session.scalar(select(Artifact).where(Artifact.task_id == id))
        artifact.expires_at = utc_now_ms() - 1
    assert client.get(url).status_code == 410
    resubmit = client.post(
        f"/api/exports/{id}/resubmit", headers={"Idempotency-Key": "resubmit"}
    ).json()["taskId"]
    assert resubmit != id and task(client, resubmit)["retryOfTaskId"] == id
    assert task(client, id)["status"] == "completed"


def test_fast_compatible_and_explicit_precise_retry(client, config, database, archive):
    fast = enqueue(client, body(archive, "fast", end=4.5))
    perform(config, database)
    assert task(client, fast)["status"] == "completed", task(client, fast)
    assert task(client, fast)["result"]["warnings"]
    incompatible = enqueue(client, body(archive, "fast"))
    perform(config, database)
    assert task(client, incompatible)["errorCode"] == "FAST_INCOMPATIBLE"
    response = client.post(
        f"/api/tasks/{incompatible}/retry",
        json={"mode": "precise"},
        headers={"Idempotency-Key": "precise"},
    )
    retry = response.json()["taskId"]
    assert retry != incompatible and task(client, retry)["payload"]["mode"] == "precise"
    perform(config, database)
    assert task(client, retry)["status"] == "completed", task(client, retry)


def test_cancel_running_and_retry_snapshot_rejects_changed_inputs(
    client, config, database, archive, monkeypatch
):
    id = enqueue(client, body(archive))
    queue = Queue(database, config, "test")
    claim = queue.claim()
    original = exports.export_media.render

    def cancel(paths, plan, target, context):
        client.post(f"/api/tasks/{id}/cancel")
        context.check()

    monkeypatch.setattr(exports.export_media, "render", cancel)
    execute(queue, claim, threading.Event())
    assert task(client, id)["status"] == "cancelled"
    assert not (config.data / "exports" / f"{id}.mp4").exists()
    monkeypatch.setattr(exports.export_media, "render", original)
    retry = client.post(f"/api/tasks/{id}/retry", json={}).json()["taskId"]
    assert retry != id
    client.post(f"/api/tasks/{retry}/cancel")
    archive[2][0].write_bytes(b"changed")
    response = client.post(f"/api/tasks/{retry}/retry", json={})
    assert response.status_code == 409 and response.json()["error"]["code"] == "INPUT_CHANGED"


def test_publish_crash_manifest_reconciles_one_artifact(
    client, config, database, archive, monkeypatch
):
    id = enqueue(client, body(archive))
    queue = Queue(database, config, "old-worker")
    replace = exports.os.replace

    def crash(source, target):
        replace(source, target)
        if target == config.data / "exports" / f"{id}.mp4":
            raise SystemExit("simulated crash after rename, before DB commit")

    monkeypatch.setattr(exports.os, "replace", crash)
    with pytest.raises(SystemExit):
        execute(queue, queue.claim(), threading.Event())
    assert task(client, id)["status"] == "running"
    assert client.get(f"/api/exports/{id}/download").status_code == 409
    monkeypatch.setattr(exports.os, "replace", replace)
    queue = Queue(database, config, "new-worker")
    queue.recover()

    def must_reconcile(*args):
        raise AssertionError("A verified published output must not be rendered twice")

    monkeypatch.setattr(exports.export_media, "render", must_reconcile)
    execute(queue, queue.claim(), threading.Event())
    done = task(client, id)
    assert done["status"] == "completed", done
    assert done["attemptNo"] == 2 and done["attempts"][0]["status"] == "interrupted"
    with Session(database) as session:
        assert len(list(session.scalars(select(Artifact).where(Artifact.kind == "export")))) == 1
    assert client.get(done["result"]["downloadUrl"]).status_code == 200


def test_long_keyframe_start_uses_edit_list_without_video_encoding(client, config, database):
    file = config.recordings_root / "beta" / "20261013_091500.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:r=25",
            "-t",
            "20",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-g",
            "500",
            "-bf",
            "0",
            "-y",
            str(file),
        ],
        check=True,
        capture_output=True,
    )
    os.utime(file, (time.time() - 120, time.time() - 120))
    source = client.post(
        "/api/sources",
        json={
            "name": "Long GOP",
            "path": str(file.parent),
            "scanOnCreate": True,
            "scanIntervalMinutes": None,
        },
    ).json()["source"]
    perform(config, database)
    data = {
        "sourceId": source["id"],
        "startAt": "2026-10-13T09:15:15+08:00",
        "endAt": "2026-10-13T09:15:16+08:00",
        "mode": "fast",
    }
    id = enqueue(client, data)
    perform(config, database)
    done = task(client, id)
    assert done["status"] == "completed", done
    assert done["result"]["videoCopied"] and done["result"]["audioCodec"] is None
    assert done["result"]["videoCodec"] == "h264"
    assert abs(done["result"]["actualDurationMs"] - 1000) <= 40
    output = config.data / "long-gop-download.mp4"
    output.write_bytes(client.get(done["result"]["downloadUrl"]).content)

    # Compare a moving picture, not a static color: visible output must begin
    # at 15 seconds, never at the preserved keyframe fifteen seconds earlier.
    def frame_hash(path, offset):
        raw = subprocess.check_output(
            [
                "ffmpeg",
                "-v",
                "error",
                "-threads",
                "1",
                "-ss",
                str(offset),
                "-i",
                str(path),
                "-map",
                "0:v:0",
                "-frames:v",
                "1",
                "-f",
                "framemd5",
                "-",
            ]
        )
        return [
            line.rsplit(b",", 1)[-1].strip()
            for line in raw.splitlines()
            if not line.startswith(b"#")
        ][0]

    assert frame_hash(output, 0) == frame_hash(file, 15)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-xerror", "-threads", "1", "-i", str(output), "-f", "null", "-"],
        check=True,
        capture_output=True,
    )


def test_cancel_at_publish_manifest_and_lease_fence(client, config, database, archive, monkeypatch):
    id = enqueue(client, body(archive))
    queue = Queue(database, config, "worker")
    claim = queue.claim()
    result, finalize = exports.export(TaskContext(queue, claim, threading.Event()))
    client.post(f"/api/tasks/{id}/cancel")
    queue.settle(claim, result=result, finalize=finalize)
    assert task(client, id)["status"] == "cancelled"
    assert not (config.data / "exports" / f"{id}.mp4").exists()
    with Session(database) as session:
        assert session.scalar(select(Artifact).where(Artifact.task_id == id)) is None
    retry = client.post(f"/api/tasks/{id}/retry", json={}).json()["taskId"]
    old = queue.claim()
    assert old.task_id == retry
    recovered = Queue(database, config, "new-worker")
    recovered.recover()
    from app.tasks.queue import LeaseLost

    with pytest.raises(LeaseLost):
        queue.settle(old, result={})
    execute(recovered, recovered.claim(), threading.Event())
    assert task(client, retry)["status"] == "completed"


def test_low_disk_fails_without_publication_and_new_id_retry_succeeds(
    client, config, database, archive, monkeypatch
):
    from collections import namedtuple

    before = [path.read_bytes() for path in archive[2]]
    id = enqueue(client, body(archive))
    original = exports.shutil.disk_usage
    disk = namedtuple("Disk", "total used free")
    monkeypatch.setattr(exports.shutil, "disk_usage", lambda _: disk(1024**3, 1024**3 - 1, 1))
    perform(config, database)
    failed = task(client, id)
    assert failed["status"] == "failed" and failed["errorCode"] == "INSUFFICIENT_STORAGE"
    assert failed["result"] is None
    assert client.get(f"/api/exports/{id}/download").status_code == 409
    assert not (config.data / "exports" / f"{id}.mp4").exists()
    with Session(database) as session:
        assert session.scalar(select(Artifact).where(Artifact.task_id == id)) is None
    monkeypatch.setattr(exports.shutil, "disk_usage", original)
    retry = client.post(f"/api/tasks/{id}/retry", json={}).json()["taskId"]
    assert retry != id and task(client, retry)["retryOfTaskId"] == id
    perform(config, database)
    assert task(client, retry)["status"] == "completed"
    assert task(client, id)["status"] == "failed"
    assert [path.read_bytes() for path in archive[2]] == before


def test_fast_merge_accepts_different_frame_intervals_with_matching_codec_headers(
    client, config, database, archive
):
    source, _, paths = archive
    original = paths[0].read_bytes()
    retimed = config.data / "retimed.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-itsscale",
            "1.25",
            "-i",
            str(paths[1]),
            "-c",
            "copy",
            "-video_track_timescale",
            "12800",
            str(retimed),
        ],
        check=True,
        capture_output=True,
    )
    retimed.replace(paths[1])
    os.utime(paths[1], (time.time() - 120, time.time() - 120))
    metadata = [
        json.loads(
            subprocess.check_output(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_data_hash",
                    "sha256",
                    "-show_entries",
                    "stream=codec_type,r_frame_rate,time_base,extradata_hash",
                    "-of",
                    "json",
                    str(path),
                ]
            )
        )["streams"][0]
        for path in paths[:2]
    ]
    assert metadata[0]["r_frame_rate"] != metadata[1]["r_frame_rate"]
    assert metadata[0]["extradata_hash"] == metadata[1]["extradata_hash"]
    assert metadata[0]["time_base"] == metadata[1]["time_base"]
    assert client.post(f"/api/sources/{source['id']}/scan").status_code == 202
    perform(config, database)
    rows = sorted(
        client.get("/api/segments", params={"sourceId": source["id"]}).json()["items"],
        key=lambda row: row["startAt"],
    )
    data = body((source, rows, paths), "fast")
    data.update(startAt=rows[0]["startAt"], endAt=rows[1]["endAt"])
    id = enqueue(client, data)
    perform(config, database)
    result = task(client, id)
    assert result["status"] == "completed", result
    assert result["result"]["mode"] == "fast"
    assert result["result"]["videoCodec"] == "h264"
    assert result["result"]["pieceCount"] == 2
    assert client.head(result["result"]["downloadUrl"]).status_code == 200
    output = config.data / "vfr-download.mp4"
    output.write_bytes(client.get(result["result"]["downloadUrl"]).content)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-xerror", "-i", str(output), "-f", "null", "-"],
        check=True,
        capture_output=True,
    )
    assert paths[0].read_bytes() == original


def test_fast_opus_b_frames_audio_clock_and_monotonic_progress(
    client, config, database, monkeypatch
):
    paths = []
    for index in range(2):
        path = config.recordings_root / "beta" / f"20261013_09150{index * 8}.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=160x90:r=25",
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency={440 + index * 440}:sample_rate=48000",
                "-t",
                "8",
                "-c:v",
                "libx264",
                "-threads",
                "1",
                "-g",
                "250",
                "-keyint_min",
                "250",
                "-sc_threshold",
                "0",
                "-bf",
                "2",
                "-c:a",
                "libopus",
                "-strict",
                "-2",
                "-y",
                str(path),
            ],
            check=True,
            capture_output=True,
        )
        os.utime(path, (time.time() - 120, time.time() - 120))
        paths.append(path)
    before = [path.read_bytes() for path in paths]
    source = client.post(
        "/api/sources",
        json={
            "name": "Opus B frames",
            "path": str(paths[0].parent),
            "scanOnCreate": True,
            "scanIntervalMinutes": None,
        },
    ).json()["source"]
    perform(config, database)
    progress, commands = [], []
    original_update = TaskContext.update
    original_process = exports.export_media.run_process

    def update(context, stage, percentage, checkpoint):
        progress.append(percentage)
        return original_update(context, stage, percentage, checkpoint)

    def process(args, *positional, **keywords):
        commands.append(args)
        return original_process(args, *positional, **keywords)

    monkeypatch.setattr(TaskContext, "update", update)
    monkeypatch.setattr(exports.export_media, "run_process", process)
    identifier = enqueue(
        client,
        {
            "sourceId": source["id"],
            "startAt": "2026-10-13T09:15:05.200+08:00",
            "endAt": "2026-10-13T09:15:11+08:00",
            "mode": "fast",
        },
    )
    perform(config, database)
    done = task(client, identifier)
    assert done["status"] == "completed", done
    assert progress == sorted(progress)
    assert any("pcm_s16le" in args for args in commands)
    assert not any("libx264" in args or "libx265" in args for args in commands)
    assert done["result"]["videoCopied"] and done["result"]["audioNormalized"]
    assert done["result"]["videoCodec"] == "h264" and done["result"]["audioCodec"] == "aac"
    assert abs(done["result"]["actualDurationMs"] - 5800) < 500
    output = config.data / "opus-b-frame-download.mp4"
    output.write_bytes(client.get(done["result"]["downloadUrl"]).content)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-xerror", "-threads", "1", "-i", str(output), "-f", "null", "-"],
        check=True,
        capture_output=True,
    )
    streams = json.loads(
        subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=start_time,duration",
                "-of",
                "json",
                str(output),
            ]
        )
    )["streams"]
    assert abs(float(streams[0]["duration"]) - float(streams[1]["duration"])) < 0.05
    assert all(abs(float(stream["start_time"])) < 0.05 for stream in streams)
    assert [path.read_bytes() for path in paths] == before


def test_fast_internal_long_gop_refuses_unsafe_seam(client, config, database):
    first = config.recordings_root / "beta" / "20261013_091500.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:r=25",
            "-t",
            "20",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-g",
            "500",
            "-keyint_min",
            "500",
            "-sc_threshold",
            "0",
            "-bf",
            "0",
            "-y",
            str(first),
        ],
        check=True,
        capture_output=True,
    )
    second = first.with_name("20261013_091505.mp4")
    second.write_bytes(first.read_bytes())
    for path in (first, second):
        os.utime(path, (time.time() - 120, time.time() - 120))
    source = client.post(
        "/api/sources",
        json={
            "name": "Unsafe internal GOP",
            "path": str(first.parent),
            "scanOnCreate": True,
            "scanIntervalMinutes": None,
        },
    ).json()["source"]
    perform(config, database)
    identifier = enqueue(
        client,
        {
            "sourceId": source["id"],
            "startAt": "2026-10-13T09:15:19+08:00",
            "endAt": "2026-10-13T09:15:21+08:00",
            "mode": "fast",
        },
    )
    perform(config, database)
    done = task(client, identifier)
    assert done["errorCode"] == "FAST_BOUNDARY_UNSAFE", done
    assert "中间拼接" in done["errorMessage"]
    assert client.get(f"/api/exports/{identifier}/download").status_code == 409
    assert not (config.data / "exports" / f"{identifier}.mp4").exists()


def test_fast_audio_cancel_releases_slot_retry_and_publish_recovery(
    client, config, database, archive, monkeypatch
):
    data = body(archive, "fast", end=4.5)
    identifier = enqueue(client, data)
    original_update = TaskContext.update
    cancelled = False

    def cancel_audio(context, stage, progress, checkpoint):
        nonlocal cancelled
        from app.db.models import RuntimeLease

        with Session(database) as session:
            held = session.scalar(
                select(RuntimeLease).where(RuntimeLease.token == context.claim.token)
            )
        if stage == "audio" and held and not cancelled:
            cancelled = True
            client.post(f"/api/tasks/{identifier}/cancel")
        return original_update(context, stage, progress, checkpoint)

    monkeypatch.setattr(TaskContext, "update", cancel_audio)
    perform(config, database)
    assert cancelled and task(client, identifier)["status"] == "cancelled"
    assert not list((config.data / "tmp" / identifier).rglob("*.wav"))
    assert client.get(f"/api/exports/{identifier}/download").status_code == 409
    monkeypatch.setattr(TaskContext, "update", original_update)
    retry = client.post(f"/api/tasks/{identifier}/retry", json={}).json()["taskId"]
    replace = exports.os.replace

    def crash(source, target):
        replace(source, target)
        if target == config.data / "exports" / f"{retry}.mp4":
            raise SystemExit("crash after rename")

    monkeypatch.setattr(exports.os, "replace", crash)
    queue = Queue(database, config, "old-fast-worker")
    with pytest.raises(SystemExit):
        execute(queue, queue.claim(), threading.Event())
    monkeypatch.setattr(exports.os, "replace", replace)
    queue = Queue(database, config, "new-fast-worker")
    queue.recover()

    def must_reconcile(*args):
        raise AssertionError("Verified fast export must not run twice")

    monkeypatch.setattr(exports.export_media, "render", must_reconcile)
    execute(queue, queue.claim(), threading.Event())
    done = task(client, retry)
    assert done["status"] == "completed" and done["attemptNo"] == 2, done
    assert client.head(done["result"]["downloadUrl"]).status_code == 200
    with Session(database) as session:
        assert len(list(session.scalars(select(Artifact).where(Artifact.task_id == retry)))) == 1
