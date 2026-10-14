"""D4 read-only real-media smoke. Downloads go only to ignored runtime data."""

import argparse
import json
import subprocess
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4


def api(base, path, body=None):
    request = urllib.request.Request(
        base + "/api" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "Idempotency-Key": str(uuid4())},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def wait(base, id, timeout=600):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            row = api(base, "/tasks/" + id)
        except OSError:
            time.sleep(0.5)
            continue
        if row["status"] in ("completed", "failed", "cancelled"):
            return row
        time.sleep(0.5)
    raise RuntimeError("Export did not finish before deadline")


def choose(base):
    source = api(base, "/sources")["items"][0]
    rows, cursor = [], None
    while True:
        page = api(
            base,
            f"/segments?sourceId={source['id']}&limit=200"
            + (f"&cursor={cursor}" if cursor else ""),
        )
        rows += page["items"]
        cursor = page["nextCursor"]
        if not cursor:
            break
    rows = sorted(rows, key=lambda row: row["startAt"])
    for left, right in zip(rows, rows[1:], strict=False):
        gap = datetime.fromisoformat(right["startAt"]) - datetime.fromisoformat(left["endAt"])
        if (
            left["durationMs"] < 400000
            and 0 <= gap.total_seconds() < 60
            and left["startAt"][:10] == right["startAt"][:10]
        ):
            return source, left, right
    raise RuntimeError("No adjacent test pieces found")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8088")
    parser.add_argument("--controls", action="store_true")
    parser.add_argument("--container", default="clipline-phase-one-clipline-1")
    parser.add_argument("--output", default="data/qa/d4-smoke")
    args = parser.parse_args()
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            if api(args.base, "/health/ready")["ready"]:
                break
        except OSError:
            pass
        time.sleep(0.5)
    else:
        raise RuntimeError("Export worker did not become ready")
    source, left, right = choose(args.base)
    begin = datetime.fromisoformat(left["endAt"]) - timedelta(seconds=5)
    finish = datetime.fromisoformat(right["startAt"]) + timedelta(seconds=5)
    body = {
        "sourceId": source["id"],
        "startAt": begin.isoformat(),
        "endAt": finish.isoformat(),
        "viewTimezone": "Asia/Shanghai",
        "name": "D4真实跨片段测试",
        "segmentIds": [left["id"], right["id"]],
    }
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    for mode in ("fast", "precise"):
        request_body = body
        if mode == "fast":
            request_body = body | {
                "startAt": left["startAt"],
                "endAt": left["endAt"],
                "segmentIds": [left["id"]],
            }
        plan = api(args.base, "/exports/plan", request_body | {"mode": mode})
        assert plan["pieceCount"] == (1 if mode == "fast" else 2) and plan[
            "expectedDurationMs"
        ] == (left["durationMs"] if mode == "fast" else 10000), plan
        id = api(
            args.base, "/exports", request_body | {"mode": mode, "planHash": plan["planHash"]}
        )["taskId"]
        done = wait(args.base, id)
        assert done["status"] == "completed", done
        request = urllib.request.Request(args.base + done["result"]["downloadUrl"])
        with (
            urllib.request.urlopen(request) as response,
            (output / f"{mode}.mp4").open("wb") as handle,
        ):
            while block := response.read(1024 * 1024):
                handle.write(block)
        results[mode] = {"taskId": id, "plan": plan, "result": done["result"]}
        print(
            json.dumps({"mode": mode, "taskId": id, "result": done["result"]}, ensure_ascii=False),
            flush=True,
        )

    if args.controls:
        control = body | {
            "startAt": left["startAt"],
            "endAt": (datetime.fromisoformat(left["startAt"]) + timedelta(seconds=20)).isoformat(),
            "segmentIds": [left["id"]],
            "mode": "precise",
            "name": "D4取消重试",
        }
        cancelled = api(args.base, "/exports", control)["taskId"]

        def running(id):
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                row = api(args.base, "/tasks/" + id)
                if (
                    row["status"] == "running"
                    and row["stage"] == "transcode"
                    and row["progress"] >= 3
                ):
                    return row
                assert row["status"] not in ("completed", "failed"), row
                time.sleep(0.2)
            raise RuntimeError("Did not reach an active transcode")

        running(cancelled)
        api(args.base, f"/tasks/{cancelled}/cancel", {})
        assert wait(args.base, cancelled)["status"] == "cancelled"
        retried = api(args.base, f"/tasks/{cancelled}/retry", {})["taskId"]
        assert retried != cancelled
        done = wait(args.base, retried)
        assert done["status"] == "completed" and done["retryOfTaskId"] == cancelled, done
        results["cancelRetry"] = {
            "cancelledTaskId": cancelled,
            "retriedTaskId": retried,
            "result": done["result"],
        }
        print("Real transcode cancellation and new-ID retry passed", flush=True)
        restart_body = control | {
            "name": "D4重启恢复",
            "endAt": (datetime.fromisoformat(left["startAt"]) + timedelta(seconds=10)).isoformat(),
        }
        restart = api(args.base, "/exports", restart_body)["taskId"]
        running(restart)
        script = (
            "import os,signal;from pathlib import Path;"
            "pid=next(int(p.name) for p in Path('/proc').iterdir() if p.name.isdigit() "
            "and (p/'cmdline').exists() and b'app.worker' in "
            "(p/'cmdline').read_bytes().split(b'\\0'));os.kill(pid,signal.SIGKILL)"
        )
        subprocess.run(["docker", "exec", args.container, "python", "-c", script], check=True)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                if api(args.base, "/health/ready")["ready"]:
                    break
            except OSError:
                pass
            time.sleep(0.5)
        done = wait(args.base, restart)
        assert (
            done["status"] == "completed"
            and done["attemptNo"] == 2
            and done["attempts"][0]["status"] == "interrupted"
        ), done
        results["restart"] = {
            "taskId": restart,
            "attempts": done["attempts"],
            "result": done["result"],
        }
        print("Real worker SIGKILL, runtime restart and attempt-2 recovery passed", flush=True)
    (output / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
