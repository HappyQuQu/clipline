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
        {"endAt": "2026-10-14T00:00:01+08:00"},
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


def test_long_keyframe_boundary_fails_without_publishing(client, config, database):
    file = config.recordings_root / "beta" / "20261013_091500.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=160x90:r=25",
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
    assert task(client, id)["errorCode"] == "FAST_BOUNDARY_UNSAFE"
    assert client.get(f"/api/exports/{id}/download").status_code == 409
    assert not (config.data / "exports" / f"{id}.mp4").exists()
    retry = client.post(f"/api/tasks/{id}/retry", json={"mode": "precise"}).json()["taskId"]
    perform(config, database)
    done = task(client, retry)
    assert done["status"] == "completed", done
    assert done["result"]["frameCount"] == 25 and done["result"]["audioCodec"] is None


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
