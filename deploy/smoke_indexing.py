"""D2 real-directory exercise. Source mount is read-only; new state stays in project data."""

import argparse
import json
import subprocess
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", default="clipline-phase-one-clipline-1")
    parser.add_argument("--url", default="http://127.0.0.1:8088")
    parser.add_argument("--restart", action="store_true")
    args = parser.parse_args()

    def call(path, body=None, method=None, key=None):
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Idempotency-Key"] = key
        request = Request(
            args.url + "/api" + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
            method=method,
        )
        with urlopen(request, timeout=10) as response:
            return json.load(response)

    def ready():
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                if call("/health/ready")["ready"]:
                    return
            except (OSError, URLError):
                pass
            time.sleep(0.25)
        raise RuntimeError("Indexing worker did not become ready")

    def wait(task_id):
        deadline = time.monotonic() + 600
        last_progress = -20
        while time.monotonic() < deadline:
            try:
                task = call(f"/tasks/{task_id}")
            except (OSError, URLError):
                time.sleep(0.25)
                continue
            processed = (task.get("checkpoint") or {}).get("processed", 0)
            if processed >= last_progress + 20:
                print(f"{task['kind']}: {task['status']}, processed={processed}", flush=True)
                last_progress = processed
            if task["status"] in ("completed", "cancelled", "failed"):
                return task
            time.sleep(0.2)
        raise RuntimeError("Scan did not complete within the local test budget")

    def submit(source_id, kind="scan"):
        return call("/tasks", {"sourceId": source_id, "kind": kind}, key=str(uuid4()))["taskId"]

    ready()
    flags = call("/capabilities")
    assert flags["backendStage"] == "indexing" and flags["scan"] and flags["reindex"]
    assert not any(flags[name] for name in ("transcription", "visualRecognition", "semanticSearch"))
    inspect = json.loads(subprocess.check_output(["docker", "inspect", args.container], text=True))[
        0
    ]
    mounts = {row["Destination"]: row for row in inspect["Mounts"]}
    assert mounts["/recordings"]["Source"] == "/Volumes/extended/clipline"
    assert not mounts["/recordings"]["RW"] and mounts["/app/data"]["RW"]
    assert mounts["/app/data"]["Source"] != mounts["/recordings"]["Source"]
    folder = call("/recording-directories?relativePath=media")["items"][0]
    created = call(
        "/sources",
        {
            "name": "本地测试录像",
            "path": folder["path"],
            "scanIntervalMinutes": None,
            "scanOnCreate": True,
        },
        key="d2-real-source",
    )
    source_id, first_id = created["source"]["id"], created["firstTaskId"]
    first = wait(first_id)
    assert first["status"] == "completed", first
    rows = call("/segments?" + urlencode({"sourceId": source_id, "limit": 200}))["items"]
    available = [row for row in rows if row["availability"] == "available"]
    assert available
    sample = available[0]
    with urlopen(args.url + sample["thumbnailUrl"], timeout=10) as response:
        assert response.read(2) == b"\xff\xd8"
    incremental = wait(submit(source_id))
    assert incremental["status"] == "completed"
    assert incremental["result"]["added"] == 0
    assert incremental["result"]["unchanged"] == len(available)
    # Force real probe work, then cancel. A new retry has its own ID and keeps the old history.
    cancelled_id = submit(source_id, "reindex")
    deadline = time.monotonic() + 20
    while call(f"/tasks/{cancelled_id}")["status"] == "queued":
        assert time.monotonic() < deadline
        time.sleep(0.1)
    call(f"/tasks/{cancelled_id}/cancel", {}, "POST")
    cancelled = wait(cancelled_id)
    assert cancelled["status"] == "cancelled"
    retry_id = call(f"/tasks/{cancelled_id}/retry", {}, key=str(uuid4()))["taskId"]
    assert retry_id != cancelled_id
    if args.restart:
        deadline = time.monotonic() + 60
        while True:
            active = call(f"/tasks/{retry_id}")
            if (
                active["status"] == "running"
                and (active.get("checkpoint") or {}).get("processed", 0) >= 2
            ):
                break
            assert time.monotonic() < deadline and active["status"] not in ("failed", "completed")
            time.sleep(0.1)
        script = (
            "import os,signal;from pathlib import Path;"
            "pid=next(int(p.name) for p in Path('/proc').iterdir() if p.name.isdigit() "
            "and (p/'cmdline').exists() and b'app.worker' in "
            "(p/'cmdline').read_bytes().split(b'\\0'));os.kill(pid,signal.SIGKILL)"
        )
        subprocess.run(["docker", "exec", args.container, "python", "-c", script], check=True)
        ready()
    retried = wait(retry_id)
    assert retried["status"] == "completed", retried
    assert retried["retryOfTaskId"] == cancelled_id
    if args.restart:
        assert retried["attemptNo"] >= 2 and retried["recoveryCount"] >= 1
        assert retried["attempts"][0]["status"] == "interrupted"
        assert retried["result"]["unchanged"] >= 2
    after = call("/segments?" + urlencode({"sourceId": source_id, "limit": 200}))["items"]
    assert {row["id"] for row in after} == {row["id"] for row in rows}
    logs = call("/logs?" + urlencode({"taskId": retry_id, "limit": 200}))["items"]
    assert any(row["eventCode"] == "TASK_COMPLETED" for row in logs)
    if args.restart:
        assert any(row["eventCode"] == "TASK_RECOVERED" for row in logs)
    print(
        json.dumps(
            {
                "arch": flags["arch"],
                "firstScan": first["result"],
                "incremental": incremental["result"],
                "cancelled": cancelled["status"],
                "retry": retried["result"],
                "attemptNo": retried["attemptNo"],
                "recoveryCount": retried["recoveryCount"],
                "stableSegmentIds": True,
                "readOnlyRecordingMount": True,
                "availableSegments": len(available),
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
