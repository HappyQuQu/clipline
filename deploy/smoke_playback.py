"""Exercise D3 playback against the independent local Docker test service."""

import argparse
import json
import subprocess
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8088")
    parser.add_argument("--container", default="clipline-phase-one-clipline-1")
    parser.add_argument("--restart", action="store_true")
    args = parser.parse_args()

    def call(path, body=None):
        request = Request(
            args.url + "/api" + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json", "Idempotency-Key": str(uuid4())},
        )
        with urlopen(request, timeout=15) as response:
            return json.load(response)

    deadline = time.monotonic() + 60
    while True:
        try:
            if call("/health/ready")["ready"]:
                break
        except OSError:
            pass
        assert time.monotonic() < deadline
        time.sleep(0.5)
    flags = call("/capabilities")
    assert flags["playback"] and flags["prepare"] and not flags["export"]
    assert not any(flags[key] for key in ("transcription", "visualRecognition", "semanticSearch"))
    info = json.loads(subprocess.check_output(["docker", "inspect", args.container], text=True))[0]
    mapping = next(row for row in info["Mounts"] if row["Destination"] == "/recordings")
    assert mapping["Source"] == "/Volumes/extended/clipline" and not mapping["RW"]
    source = call("/sources")["items"][0]
    dates = call(f"/sources/{source['id']}/dates")["items"]
    assert len(dates) >= 2
    day = call("/timeline?" + urlencode({"sourceId": source["id"], "date": dates[0], "limit": 200}))
    assert day["coverageMs"] > 0 and day["items"]
    rows = call("/segments?" + urlencode({"sourceId": source["id"], "limit": 200}))["items"]
    segment = None
    for row in sorted(rows, key=lambda row: row["durationMs"]):
        status = call(f"/segments/{row['id']}/playback")
        if not args.restart or status["status"] not in ("ready", "direct"):
            segment = row
            break
    assert segment, "No uncached recording available for restart exercise"
    first = call(f"/segments/{segment['id']}/prepare", {})
    second = call(f"/segments/{segment['id']}/prepare", {})
    assert first["taskId"] == second["taskId"] and second["reused"]
    killed = False
    deadline, last_progress = time.monotonic() + 3600, -10
    while first["taskId"]:
        try:
            task = call("/tasks/" + first["taskId"])
        except OSError:
            time.sleep(0.5)
            continue
        if task["progress"] >= last_progress + 10:
            print(f"prepare: {task['status']} {task['progress']}%", flush=True)
            last_progress = task["progress"]
        if args.restart and not killed and task["stage"] == "transcode" and task["progress"] >= 3:
            script = (
                "import os,signal;from pathlib import Path;"
                "pid=next(int(p.name) for p in Path('/proc').iterdir() if p.name.isdigit() "
                "and (p/'cmdline').exists() and b'app.worker' in "
                "(p/'cmdline').read_bytes().split(b'\\0'));os.kill(pid,signal.SIGKILL)"
            )
            subprocess.run(["docker", "exec", args.container, "python", "-c", script], check=True)
            killed = True
        if task["status"] == "completed":
            break
        assert task["status"] not in ("failed", "cancelled"), task
        assert time.monotonic() < deadline
        time.sleep(0.5)
    if args.restart:
        assert killed and task["attemptNo"] >= 2 and task["attempts"][0]["status"] == "interrupted"
    state = call(f"/segments/{segment['id']}/playback")
    assert state["status"] in ("ready", "direct")
    assert call(f"/segments/{segment['id']}/prepare", {})["taskId"] is None
    with urlopen(
        Request(args.url + state["mediaUrl"], headers={"Range": "bytes=0-99"}), timeout=15
    ) as response:
        assert response.status == 206 and len(response.read()) == 100
    try:
        urlopen(
            Request(args.url + state["mediaUrl"], headers={"Range": "bytes=999999999999-"}),
            timeout=15,
        )
        raise AssertionError("Out-of-bounds Range was accepted")
    except OSError as error:
        assert getattr(error, "code", None) == 416
    sample = call(f"/sources/{source['id']}/resolve?" + urlencode({"at": segment["startAt"]}))
    assert sample["status"] == "recording" and sample["offsetMs"] >= 0
    print(
        json.dumps(
            {
                "arch": flags["arch"],
                "dateCount": len(dates),
                "daySegmentCount": day["segmentCount"],
                "proxyReady": state["proxy"],
                "range206": True,
                "range416": True,
                "cachedRequestReused": True,
                "restartAttemptNo": task["attemptNo"] if first["taskId"] else None,
                "readOnlyMount": True,
            },
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
