"""D5 real-data verification, restricted to the independent local Docker service."""

import argparse
import hashlib
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4

from smoke_exports import wait


def call(base, path, body=None, method=None):
    request = urllib.request.Request(
        base + "/api" + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Content-Type": "application/json", "Idempotency-Key": str(uuid4())},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def docker_py(container, code, *args):
    return subprocess.check_output(
        ["docker", "exec", container, "python", "-c", code, *args], text=True
    ).strip()


def original_signature():
    files = sorted((Path("/Volumes/extended/clipline") / "media").rglob("*.mp4"))
    value = hashlib.sha256()
    for path in files:
        info = path.stat()
        value.update(
            f"{path.relative_to(path.parents[2])}:{info.st_size}:{info.st_mtime_ns}".encode()
        )
        with path.open("rb") as handle:
            value.update(handle.read(65536))
            handle.seek(max(0, info.st_size - 65536))
            value.update(handle.read(65536))
    return len(files), sum(path.stat().st_size for path in files), value.hexdigest()


CONTROL = """
import json,sys
from pathlib import Path
from sqlalchemy import select
from app.core.config import AppConfig
from app.core.time import utc_now_ms
from app.db.session import make_engine
from app.db.models import Artifact,RuntimeLease
from app.db.transactions import write_session
from app.services.maintenance import maintain
config=AppConfig();engine=make_engine(config);task_id=sys.argv[1]
with write_session(engine) as session:
    artifact=session.scalar(select(Artifact).where(Artifact.task_id==task_id,Artifact.kind=='export'))
    artifact.expires_at=utc_now_ms()-1
    path=config.data/artifact.relative_path
    query=select(RuntimeLease).where(RuntimeLease.resource_key.startswith('use:'+artifact.id+':'))
    for row in session.scalars(query):
        row.expires_at=1
summary=maintain(engine,config)
print(json.dumps({'exists':path.exists(),'summary':summary}))
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8088")
    parser.add_argument("--container", default="clipline-phase-one-clipline-1")
    parser.add_argument("--output", default="data/qa/d5-smoke")
    args = parser.parse_args()
    info = json.loads(subprocess.check_output(["docker", "inspect", args.container], text=True))[0]
    mount = next(row for row in info["Mounts"] if row["Destination"] == "/recordings")
    assert mount["Source"] == "/Volumes/extended/clipline" and not mount["RW"]
    before = original_signature()
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            if call(args.base, "/health/ready")["ready"]:
                break
        except OSError:
            pass
        time.sleep(0.5)
    configured = call(args.base, "/settings")
    original = configured["groups"]["tasks"]["values"]
    results = {}
    try:
        latest = docker_py(
            args.container,
            "from sqlalchemy import select,func;from app.core.config import AppConfig;"
            "from app.db.session import make_engine;from app.db.models import Event;"
            "engine=make_engine(AppConfig());"
            "print(engine.connect().execute(select(func.max(Event.id))).scalar() or 0)",
        )
        stream = urllib.request.urlopen(args.base + "/api/events?after=" + latest, timeout=10)
        saved = call(
            args.base,
            "/settings/tasks",
            {"revision": configured["groups"]["tasks"]["revision"], "values": {"concurrency": 1}},
            "PATCH",
        )
        deadline = time.monotonic() + 10
        resumed = False
        while time.monotonic() < deadline:
            line = stream.readline().decode()
            if line.startswith("data:") and "SETTINGS_UPDATED" in line:
                resumed = True
                break
        stream.close()
        assert resumed
        unchanged = call(args.base, "/settings")["groups"]
        assert all(
            unchanged[group] == configured["groups"][group]
            for group in ("scan", "playback", "export")
        )
        try:
            call(
                args.base,
                "/settings/tasks",
                {
                    "revision": configured["groups"]["tasks"]["revision"],
                    "values": {"concurrency": 3},
                },
                "PATCH",
            )
        except urllib.error.HTTPError as error:
            assert error.code == 409
        else:
            raise AssertionError("Old revision must conflict")
        results["settings"] = {
            "savedRevision": saved["revision"],
            "sseReplay": True,
            "otherGroupsPreserved": True,
            "staleSaveStatus": 409,
        }
        print("Settings revision, category isolation and SSE replay passed", flush=True)
        source = call(args.base, "/sources")["items"][0]
        rows = call(args.base, f"/segments?sourceId={source['id']}&limit=200")["items"]
        segment = min(
            (row for row in rows if row["availability"] == "available"),
            key=lambda row: row["durationMs"],
        )
        task_id = call(
            args.base,
            "/exports",
            {
                "sourceId": source["id"],
                "startAt": segment["startAt"],
                "endAt": segment["endAt"],
                "mode": "fast",
                "segmentIds": [segment["id"]],
                "name": "D5下载保护与到期测试",
            },
        )["taskId"]
        done = wait(args.base, task_id)
        assert done["status"] == "completed", done
        url = args.base + done["result"]["downloadUrl"]
        download = urllib.request.urlopen(url, timeout=30)
        initial = download.read(65536)
        assert len(initial) == 65536
        protected = json.loads(docker_py(args.container, CONTROL, task_id))
        assert protected["exists"], protected
        try:
            urllib.request.urlopen(url, timeout=10)
        except urllib.error.HTTPError as error:
            assert error.code == 410
        else:
            raise AssertionError("New expired downloads must be refused")
        value = hashlib.sha256(initial)
        size = len(initial)
        while block := download.read(1024 * 1024):
            value.update(block)
            size += len(block)
        download.close()
        assert size == done["result"]["sizeBytes"] and value.hexdigest() == done["result"]["sha256"]
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            cleaned = json.loads(docker_py(args.container, CONTROL, task_id))
            if not cleaned["exists"]:
                break
            time.sleep(0.2)
        assert not cleaned["exists"], cleaned
        expired = call(args.base, "/tasks/" + task_id)
        assert expired["status"] == "completed" and expired["downloadStatus"] == "expired"
        retry = call(args.base, f"/exports/{task_id}/resubmit", {})["taskId"]
        assert retry != task_id
        restored = wait(args.base, retry)
        assert restored["status"] == "completed" and restored["retryOfTaskId"] == task_id
        results["expiry"] = {
            "taskId": task_id,
            "protectedWhileStreaming": True,
            "downloadBytes": size,
            "sha256": value.hexdigest(),
            "expiredStatus": 410,
            "physicalCleanup": True,
            "resubmittedTaskId": retry,
        }
        print(
            "Real download lock, expiry 410, byte-identical completion, "
            "physical cleanup and new-ID resubmit passed",
            flush=True,
        )
        listing = call(args.base, f"/logs?taskId={task_id}&limit=2")
        assert listing["nextCursor"] and listing["summary"]["total"] > 2
        exported = call(args.base, f"/logs/export?taskId={task_id}&snapshot={listing['snapshot']}")
        assert len(exported["items"]) == listing["summary"]["total"]
        diagnostic = call(args.base, f"/system/diagnostics?taskId={task_id}")
        assert (
            diagnostic["system"]["schema"] == "0004_log_sequence" and len(diagnostic["tasks"]) == 1
        )
        assert all("payload" not in task for task in diagnostic["tasks"])
        results["logs"] = {
            "loadedPage": 2,
            "exportedCount": len(exported["items"]),
            "fullFilteredSnapshot": True,
            "diagnosticSchema": diagnostic["system"]["schema"],
        }
        output = Path(args.output)
        output.mkdir(parents=True, exist_ok=True)
        (output / "logs.json").write_text(json.dumps(exported, ensure_ascii=False, indent=2))
        (output / "diagnostics.json").write_text(
            json.dumps(diagnostic, ensure_ascii=False, indent=2)
        )
        backup = subprocess.check_output(
            ["docker", "exec", args.container, "python", "-m", "app.backup", "create"], text=True
        ).strip()
        verified = json.loads(
            subprocess.check_output(
                ["docker", "exec", args.container, "python", "-m", "app.backup", "verify", backup],
                text=True,
            )
        )
        results["backup"] = {
            "schema": verified["schema"],
            "sizeBytes": verified["sizeBytes"],
            "sha256": verified["sha256"],
        }
        print(
            "Full filtered log export, diagnostic whitelist and consistent live backup passed",
            flush=True,
        )
        flags = call(args.base, "/capabilities")
        assert not any(
            flags[key] for key in ("transcription", "visualRecognition", "semanticSearch")
        )
        after = original_signature()
        assert before == after and after[0] == 123 and after[1] == 16508780544
        results["originals"] = {
            "count": after[0],
            "bytes": after[1],
            "statAndSampleDigestUnchanged": True,
            "readOnlyMount": True,
            "recognitionEnabled": False,
        }
        (output / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
        print(
            "Original read-only recordings unchanged; phase-two recognition stays disabled",
            flush=True,
        )
    finally:
        current = call(args.base, "/settings")["groups"]["tasks"]
        if current["values"] == {"concurrency": 1}:
            call(
                args.base,
                "/settings/tasks",
                {"revision": current["revision"], "values": original},
                "PATCH",
            )


if __name__ == "__main__":
    main()
