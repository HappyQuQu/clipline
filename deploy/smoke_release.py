"""Disposable Docker acceptance using generated media, for native CI or local emulation.

Never mounts the NAS recordings. Real-data acceptance uses smoke_exports/operations.
"""

import argparse
import hashlib
import json
import os
import platform
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from check_image import INSPECT


def run(*command):
    return subprocess.check_output(command, text=True).strip()


class Smoke:
    def __init__(self, args):
        self.args = args
        self.output = Path(args.output).resolve()
        self.root = self.output / str(uuid4())
        self.root.mkdir(parents=True)
        self.recordings = self.root / "recordings"
        self.data = self.root / "data"
        self.recordings.mkdir()
        self.data.mkdir()
        self.name = "clipline-d6-" + uuid4().hex[:12]
        self.base = None
        self.results = {"startedAt": datetime.now().astimezone().isoformat(), "checks": {}}
        self.platform_args = ["--platform", args.platform] if args.platform else []

    def docker(self, *command):
        return run("docker", *command)

    def generate(self):
        directory = self.recordings / "camera"
        directory.mkdir()
        for filename, codec, length, size in (
            ("20261013_091500.mp4", "libx264", 2, "160x90"),
            ("20261013_091503.mp4", "libx264", 2, "160x90"),
            ("20261013_091510.mp4", "libx265", 4, "320x180"),
            ("20261013_091520.mp4", "libx264", 60, "1280x720"),
        ):
            audio = (
                ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"] if length > 2 else []
            )
            options = (
                ["-x265-params", "pools=none:frame-threads=1:log-level=error"]
                if codec == "libx265"
                else []
            )
            if audio:
                options += ["-c:a", "libopus" if codec == "libx265" else "aac"]
            self.docker(
                "run",
                "--rm",
                *self.platform_args,
                "--network",
                "none",
                "--user",
                f"{os.getuid()}:{os.getgid()}",
                "--mount",
                f"type=bind,source={directory},target=/fixtures",
                "--entrypoint",
                "ffmpeg",
                self.args.image,
                "-nostdin",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"testsrc2=s={size}:r=25",
                *audio,
                "-t",
                str(length),
                "-c:v",
                codec,
                "-threads",
                "1",
                "-g",
                "25",
                "-bf",
                "0",
                "-pix_fmt",
                "yuv420p",
                *options,
                "-y",
                "/fixtures/" + filename,
            )
            os.utime(directory / filename, (time.time() - 120, time.time() - 120))

    def signature(self):
        return {
            str(p.relative_to(self.recordings)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(self.recordings.rglob("*.mp4"))
        }

    def call(self, path, body=None, method=None, key=None):
        request = urllib.request.Request(
            self.base + "/api" + path,
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers={"Content-Type": "application/json", "Idempotency-Key": key or str(uuid4())},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)

    def ready(self, timeout=90):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                if self.call("/health/ready")["ready"]:
                    return
            except OSError:
                pass
            time.sleep(0.2)
        raise AssertionError("Runtime did not become ready")

    def wait(self, id, *, running=False, timeout=180):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                row = self.call("/tasks/" + id)
            except OSError:
                time.sleep(0.2)
                continue
            if running and row["status"] == "running" and row["stage"] == "transcode":
                return row
            if row["status"] in ("completed", "failed", "cancelled"):
                assert not running, row
                return row
            time.sleep(0.03 if running else 0.2)
        raise AssertionError("Task timed out: " + id)

    def exec_py(self, code, *args):
        return self.docker("exec", self.name, "python", "-c", code, *args)

    def download(self, row, label):
        result = row["result"]
        url = self.base + result["downloadUrl"]
        with urllib.request.urlopen(url, timeout=30) as response:
            payload = response.read()
        assert len(payload) == result["sizeBytes"]
        assert hashlib.sha256(payload).hexdigest() == result["sha256"]
        request = urllib.request.Request(url, headers={"Range": "bytes=0-99"})
        with urllib.request.urlopen(request, timeout=10) as response:
            assert response.status == 206 and response.read() == payload[:100]
        (self.root / (label + ".mp4")).write_bytes(payload)
        return {"bytes": len(payload), "sha256": result["sha256"], "result": result}

    def error(self, path, status, body=None):
        try:
            self.call(path, body)
        except urllib.error.HTTPError as error:
            assert error.code == status, (status, error.code, error.read())
        else:
            raise AssertionError("Request must fail: " + path)

    def check(self, name, value=True):
        self.results["checks"][name] = value
        print("PASS " + name, flush=True)

    def exercise(self):
        image = json.loads(
            self.docker(
                "run",
                "--rm",
                *self.platform_args,
                "--network",
                "none",
                "--entrypoint",
                "python",
                self.args.image,
                "-c",
                INSPECT,
            )
        )
        expected_arch = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "amd64"}
        host = expected_arch.get(platform.machine(), platform.machine())
        image_arch = expected_arch[image["arch"]]
        if self.args.require_native:
            assert host == image_arch, (host, image_arch)
        self.results["environment"] = {
            "hostArch": platform.machine(),
            "image": image,
            "native": host == image_arch,
            "cpuCount": os.cpu_count(),
            "memory": Path("/proc/meminfo").read_text().splitlines()[0]
            if Path("/proc/meminfo").exists()
            else "macOS Docker VM",
        }
        self.generate()
        before = self.signature()
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            host_port = listener.getsockname()[1]
        self.docker(
            "run",
            "-d",
            *self.platform_args,
            "--name",
            self.name,
            "--init",
            "--restart",
            "unless-stopped",
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "-p",
            f"127.0.0.1:{host_port}:8080",
            "--mount",
            f"type=bind,source={self.recordings},target=/recordings,readonly",
            "--mount",
            f"type=bind,source={self.data},target=/app/data",
            "-e",
            "CLIPLINE_MEDIA_THREADS=1",
            "-e",
            "CLIPLINE_EXPORT_MAX_WIDTH=1280",
            "-e",
            "CLIPLINE_PLAYBACK_MAX_WIDTH=320",
            "-e",
            "CLIPLINE_MAINTENANCE_INTERVAL_SECONDS=1",
            "-e",
            "CLIPLINE_USAGE_IDLE_SECONDS=0",
            self.args.image,
        )
        port = self.docker("port", self.name, "8080/tcp").split(":")[-1]
        self.base = "http://127.0.0.1:" + port
        self.ready()
        info = json.loads(self.docker("inspect", self.name))[0]
        mount = next(m for m in info["Mounts"] if m["Destination"] == "/recordings")
        assert not mount["RW"]
        flags = self.call("/capabilities")
        assert all(flags[k] for k in ("scan", "prepare", "playback", "export", "reindex"))
        assert not any(flags[k] for k in ("transcription", "visualRecognition", "semanticSearch"))
        for route in ("/", "/?mode=demo"):
            with urllib.request.urlopen(self.base + route) as response:
                assert response.status == 200 and b'<div id="root">' in response.read()
        self.check("image-runtime-and-readonly", image)
        directory = self.call("/recording-directories")["items"]
        assert any(row["name"] == "camera" for row in directory)
        created = self.call(
            "/sources",
            {
                "name": "D6 generated camera",
                "path": "/recordings/camera",
                "scanIntervalMinutes": None,
                "scanOnCreate": True,
            },
        )
        source = created["source"]
        assert self.wait(created["firstTaskId"])["status"] == "completed"
        sid = source["id"]
        self.error("/sources", 422, {"name": "P2", "path": "/recordings", "autoTranscribe": True})
        self.error("/sources", 409, {"name": "Duplicate", "path": "/recordings/camera"})
        self.error("/recording-directories?relativePath=../", 422)
        rows = sorted(
            self.call(f"/segments?sourceId={sid}&limit=200")["items"],
            key=lambda row: row["startAt"],
        )
        assert len(rows) == 4
        timeline = self.call(
            "/timeline?"
            + urllib.parse.urlencode(
                {
                    "sourceId": sid,
                    "date": "2026-10-13",
                    "limit": 200,
                }
            )
        )
        assert timeline["segmentCount"] == 4 and timeline["coverageMs"] > 0
        assert self.call(f"/sources/{sid}/dates")["items"] == ["2026-10-13"]
        assert (
            self.call(
                f"/sources/{sid}/resolve?" + urllib.parse.urlencode({"at": rows[0]["startAt"]})
            )["status"]
            == "recording"
        )
        assert len(self.call(f"/segments?sourceId={sid}&q=09%3A15%3A03")["items"]) >= 1
        direct = self.call(f"/segments/{rows[0]['id']}/playback")
        assert direct["status"] == "direct"
        with urllib.request.urlopen(
            urllib.request.Request(self.base + direct["mediaUrl"], headers={"Range": "bytes=0-99"})
        ) as response:
            assert response.status == 206 and len(response.read()) == 100
        self.check("source-index-timeline-detail-search-direct-range")
        proxy_id = self.call(f"/segments/{rows[2]['id']}/prepare", {})["taskId"]
        assert self.wait(proxy_id)["status"] == "completed"
        prepared = self.call(f"/segments/{rows[2]['id']}/playback")
        assert prepared["status"] == "ready" and prepared["proxy"]
        assert rows[2]["videoCodec"] == "hevc" and rows[2]["audioCodec"] == "opus"
        assert self.call(f"/segments/{rows[2]['id']}/prepare", {})["taskId"] is None
        self.check("browser-compatible-proxy-and-cache")
        body = {
            "sourceId": sid,
            "startAt": rows[0]["startAt"],
            "endAt": rows[1]["endAt"],
            "segmentIds": [r["id"] for r in rows[:2]],
            "name": "D6区间导出",
        }
        for mode in ("fast", "precise"):
            plan = self.call("/exports/plan", body | {"mode": mode})
            assert plan["pieceCount"] == 2 and plan["expectedDurationMs"] == 4000
            task_id = self.call("/exports", body | {"mode": mode, "planHash": plan["planHash"]})[
                "taskId"
            ]
            done = self.wait(task_id)
            assert done["status"] == "completed", done
            assert abs(done["result"]["actualDurationMs"] - 4000) <= (
                40 if mode == "precise" else 5000
            )
            self.check(mode + "-cross-piece-export-download", self.download(done, mode))
        control = {
            "sourceId": sid,
            "startAt": rows[3]["startAt"],
            "endAt": rows[3]["endAt"],
            "segmentIds": [rows[3]["id"]],
            "mode": "precise",
            "name": "D6取消恢复",
        }
        cancel_id = self.call("/exports", control)["taskId"]
        self.wait(cancel_id, running=True)
        self.call(f"/tasks/{cancel_id}/cancel", {})
        assert self.wait(cancel_id)["status"] == "cancelled"
        retry_id = self.call(f"/tasks/{cancel_id}/retry", {})["taskId"]
        assert retry_id != cancel_id
        retried = self.wait(retry_id)
        assert retried["status"] == "completed" and retried["retryOfTaskId"] == cancel_id
        self.check("actual-transcode-cancel-and-new-id-retry")
        restart_id = self.call("/exports", control | {"name": "D6异常重启"})["taskId"]
        self.wait(restart_id, running=True)
        self.exec_py(
            "import os,signal;from pathlib import Path;"
            "pid=next(int(p.name) for p in Path('/proc').iterdir() if p.name.isdigit() "
            "and (p/'cmdline').exists() and b'app.worker' in "
            "(p/'cmdline').read_bytes().split(b'\\0'));os.kill(pid,signal.SIGKILL)"
        )
        self.ready()
        resumed = self.wait(restart_id)
        assert resumed["status"] == "completed" and resumed["attemptNo"] == 2, resumed
        assert resumed["attempts"][0]["status"] == "interrupted"
        self.check(
            "worker-failure-container-restart-persistent-recovery",
            {
                "attempts": resumed["attempts"],
                "download": self.download(resumed, "recovered"),
            },
        )
        configured = self.call("/settings")
        saved = self.call(
            "/settings/tasks",
            {
                "revision": configured["groups"]["tasks"]["revision"],
                "values": {"concurrency": 1},
            },
            "PATCH",
        )
        self.docker("restart", "--time", "12", self.name)
        self.ready()
        assert self.call("/settings")["groups"]["tasks"] == saved
        listing = self.call(f"/logs?taskId={restart_id}&limit=2")
        exported = self.call(f"/logs/export?taskId={restart_id}&snapshot={listing['snapshot']}")
        assert len(exported["items"]) == listing["summary"]["total"] > 2
        backup = json.loads(
            self.exec_py(
                "from app.backup import create,verify;from app.core.config import AppConfig;"
                "import json;c=AppConfig();b=create(c);print(json.dumps(verify(c,b.name)[1]))"
            )
        )
        self.check("saved-settings-full-logs-consistent-backup", {"backup": backup})
        cleanup_code = (
            "from app.core.config import AppConfig;from app.db.session import make_engine;"
            "from app.db.transactions import write_session;from app.db.models import Artifact;"
            "from sqlalchemy import select;from app.services.maintenance import maintain;"
            "import sys;c=AppConfig();e=make_engine(c);"
            "\nwith write_session(e) as s:\n"
            " a=s.scalar(select(Artifact).where(Artifact.task_id==sys.argv[1]));a.expires_at=1\n"
            "p=c.data/a.relative_path\nmaintain(e,c)\nprint(int(p.exists()))"
        )
        deadline = time.monotonic() + 10
        while self.exec_py(cleanup_code, restart_id) != "0":
            assert time.monotonic() < deadline, "Expired result remained after stream closed"
            time.sleep(0.2)
        self.error(f"/exports/{restart_id}/download", 410)
        assert self.call("/tasks/" + restart_id)["downloadStatus"] == "expired"
        assert self.signature() == before
        self.check("expiry-cleanup-original-hashes-phase-two-disabled")
        self.results["passed"] = True

    def finish(self):
        self.results["finishedAt"] = datetime.now().astimezone().isoformat()
        if self.base:
            try:
                logs = subprocess.run(["docker", "logs", self.name], capture_output=True, text=True)
                (self.root / "container.log").write_text(logs.stdout + logs.stderr)
            except subprocess.CalledProcessError:
                pass
            subprocess.run(["docker", "rm", "-f", self.name], check=False, capture_output=True)
        (self.output / "results.json").write_text(json.dumps(self.results, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--platform")
    parser.add_argument("--require-native", action="store_true")
    parser.add_argument("--output", default="data/qa/d6-release")
    args = parser.parse_args()
    smoke = Smoke(args)
    try:
        smoke.exercise()
    finally:
        smoke.finish()


if __name__ == "__main__":
    main()
