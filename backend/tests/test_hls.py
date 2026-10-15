import os
import subprocess
import threading
import time
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Artifact
from app.db.transactions import write_session
from app.services import media
from app.services.maintenance import evict_playback, maintain
from app.tasks.queue import Queue
from app.worker import execute


@pytest.fixture
def indexed_stream(client, config, database, monkeypatch):
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
            "testsrc2=s=160x90:r=25",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440",
            "-t",
            "12",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-c:a",
            "aac",
            "-y",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    os.utime(path, (1700000000, 1700000000))
    source = client.post(
        "/api/sources",
        json={
            "name": "Stream",
            "path": str(path.parent),
            "scanOnCreate": True,
            "scanIntervalMinutes": None,
        },
    ).json()["source"]
    queue = Queue(database, config, "test")
    execute(queue, queue.claim(), threading.Event())
    segment = client.get("/api/segments", params={"sourceId": source["id"]}).json()["items"][0]
    original = media.run_process

    def paced(args, context, timeout, on_poll=None):
        if "-hls_time" in args:
            i = args.index("-i")
            args = args[:i] + ["-readrate", "4"] + args[i:]
        return original(args, context, timeout, on_poll)

    monkeypatch.setattr(media, "run_process", paced)
    return segment, path


def submit(client, segment, start=0):
    response = client.post(
        f"/api/segments/{segment['id']}/prepare", json={"mode": "stream", "startMs": start}
    )
    assert response.status_code == 202, response.text
    return response.json()["taskId"]


def run_worker(config, database):
    queue = Queue(database, config, "test")
    claim = queue.claim()
    assert claim
    stopped = threading.Event()
    thread = threading.Thread(target=execute, args=(queue, claim, stopped))
    thread.start()
    return thread, stopped


def wait_for(get, condition, timeout=15):
    deadline = time.monotonic() + timeout
    while True:
        data = get()
        if condition(data):
            return data
        assert time.monotonic() < deadline, data
        time.sleep(0.03)


def view(client, segment, task, active=True, client_id="10000000-0000-4000-8000-000000000001"):
    return client.post(
        f"/api/segments/{segment['id']}/hls/{task}/lease",
        json={"clientId": client_id, "active": active},
    )


def test_first_fragment_plays_before_task_finishes_and_cache_is_reused(
    client, config, database, indexed_stream
):
    segment, path = indexed_stream
    before = path.read_bytes()
    task = submit(client, segment)
    assert submit(client, segment) == task
    assert view(client, segment, task).json()["leased"]
    thread, stop = run_worker(config, database)
    try:
        state = wait_for(
            lambda: client.get(f"/api/segments/{segment['id']}/playback?mode=stream").json(),
            lambda s: s["status"] == "streaming",
        )
        running = client.get("/api/tasks/" + task).json()
        assert running["status"] == "running" and running["progress"] < 100
        playlist = client.get(state["mediaUrl"])
        assert playlist.status_code == 200
        assert "#EXT-X-ENDLIST" not in playlist.text
        url = next(line for line in playlist.text.splitlines() if line.startswith("/api"))
        response = client.get(url, headers={"Range": "bytes=0-187"})
        assert (
            response.status_code == 206
            and response.content[0] == 0x47
            and len(response.content) == 188
        )
        assert response.headers["content-type"] == "video/mp2t"
        with write_session(database) as session:
            with pytest.raises(AppError, match="缓存空间不足"):
                config.playback_cache_max_bytes = 1
                evict_playback(session, config, required=1)
        config.playback_cache_max_bytes = 2 * 1024**3
        thread.join(10)
        assert not thread.is_alive()
        done = client.get("/api/tasks/" + task).json()
        assert done["status"] == "completed", done
        assert len(done["result"]["hlsChunks"]) == 3
        assert "#EXT-X-ENDLIST" in client.get(state["mediaUrl"]).text
        assert submit(client, segment) is None
        assert path.read_bytes() == before
        assert client.get(url.replace(segment["fingerprint"], "wrong")).status_code == 409
    finally:
        stop.set()
        thread.join(10)


def test_restart_preserves_prefix_and_stable_playlist_then_resumes(
    client, config, database, indexed_stream
):
    segment, path = indexed_stream
    task = submit(client, segment)
    view(client, segment, task)
    thread, stop = run_worker(config, database)
    state = wait_for(
        lambda: client.get(f"/api/segments/{segment['id']}/playback?mode=stream").json(),
        lambda s: s["status"] == "streaming",
    )
    prefix = client.get(state["mediaUrl"]).text
    first_url = next(line for line in prefix.splitlines() if line.startswith("/api"))
    first_bytes = client.get(first_url).content
    stop.set()
    thread.join(10)
    assert not thread.is_alive()
    assert client.get("/api/tasks/" + task).json()["status"] == "queued"
    assert client.get(first_url).content == first_bytes
    Queue(database, config, "new").recover()
    resumed, stop2 = run_worker(config, database)
    try:
        resumed.join(12)
        assert not resumed.is_alive()
        done = client.get("/api/tasks/" + task).json()
        assert done["status"] == "completed", done
        assert done["attemptNo"] == 2 and done["attempts"][0]["status"] == "shutdown"
        assert len(done["result"]["hlsChunks"]) == 3
        assert client.get(first_url).content == first_bytes
        listing = client.get(state["mediaUrl"]).text
        assert "#EXT-X-DISCONTINUITY" in listing and "#EXT-X-ENDLIST" in listing
        assert len(set(item["id"] for item in done["result"]["hlsChunks"])) == 3
    finally:
        stop2.set()
        resumed.join(10)


def test_last_viewer_leaving_cancels_but_another_viewer_protects_stream(
    client, config, database, indexed_stream
):
    segment, _ = indexed_stream
    task = submit(client, segment)
    other = str(uuid4())
    view(client, segment, task)
    view(client, segment, task, client_id=other)
    thread, stop = run_worker(config, database)
    try:
        state = wait_for(
            lambda: client.get(f"/api/segments/{segment['id']}/playback?mode=stream").json(),
            lambda s: s["status"] == "streaming",
        )
        view(client, segment, task, False)
        time.sleep(0.4)
        assert client.get("/api/tasks/" + task).json()["status"] == "running"
        view(client, segment, task, False, other)
        done = wait_for(
            lambda: client.get("/api/tasks/" + task).json(), lambda t: t["status"] == "cancelled"
        )
        assert done["progress"] < 100
        assert client.get(state["mediaUrl"]).status_code == 410
        config.usage_idle_seconds = 0
        maintain(database, config)
        with Session(database) as session:
            assert not list(
                session.scalars(
                    select(Artifact).where(Artifact.task_id == task, Artifact.status == "ready")
                )
            )
        retry = client.post("/api/tasks/" + task + "/retry", json={}).json()["taskId"]
        assert retry != task
        assert client.get("/api/tasks/" + retry).json()["payload"]["mode"] == "stream"
    finally:
        stop.set()
        thread.join(10)


def test_seek_position_is_bounded_and_generates_only_remaining_interval(
    client, config, database, indexed_stream
):
    segment, _ = indexed_stream
    assert (
        client.post(
            f"/api/segments/{segment['id']}/prepare",
            json={"mode": "stream", "startMs": segment["durationMs"]},
        ).status_code
        == 422
    )
    task = submit(client, segment, 6500)
    view(client, segment, task)
    assert client.get("/api/tasks/" + task).json()["payload"]["startMs"] == 4000
    thread, stop = run_worker(config, database)
    try:
        thread.join(12)
        done = client.get("/api/tasks/" + task).json()
        assert done["status"] == "completed", done
        assert done["result"]["startMs"] == 4000 and done["result"]["durationMs"] == 8000
        assert len(done["result"]["hlsChunks"]) == 2
    finally:
        stop.set()
        thread.join(10)


@pytest.mark.parametrize("failure", ["capacity", "corrupt"])
def test_invalid_or_over_budget_chunks_are_never_published(
    client, config, database, indexed_stream, monkeypatch, failure
):
    segment, path = indexed_stream
    before = path.read_bytes()
    if failure == "capacity":
        config.playback_cache_max_bytes = 1
    else:
        probe = media.probe

        def invalid(path, context):
            result = probe(path, context)
            return result | {"video_codec": "hevc"} if path.suffix == ".ts" else result

        monkeypatch.setattr(media, "probe", invalid)
    task = submit(client, segment)
    view(client, segment, task)
    thread, stop = run_worker(config, database)
    try:
        thread.join(10)
        done = client.get("/api/tasks/" + task).json()
        assert done["status"] == "failed", done
        assert done["errorCode"] == (
            "PLAYBACK_CACHE_FULL" if failure == "capacity" else "INVALID_PLAYBACK_OUTPUT"
        )
        with Session(database) as session:
            assert not list(session.scalars(select(Artifact).where(Artifact.task_id == task)))
        assert path.read_bytes() == before
    finally:
        stop.set()
        thread.join(10)


def test_source_change_after_first_fragment_stops_publication(
    client, config, database, indexed_stream
):
    segment, path = indexed_stream
    task = submit(client, segment)
    view(client, segment, task)
    thread, stop = run_worker(config, database)
    try:
        state = wait_for(
            lambda: client.get(f"/api/segments/{segment['id']}/playback?mode=stream").json(),
            lambda s: s["status"] == "streaming",
        )
        os.utime(path, ns=(path.stat().st_atime_ns, path.stat().st_mtime_ns + 1))
        assert client.get(state["mediaUrl"]).status_code == 409
        thread.join(10)
        done = client.get("/api/tasks/" + task).json()
        assert done["status"] == "failed", done
        assert done["errorCode"] == "RECORDING_CHANGED"
    finally:
        stop.set()
        thread.join(10)
