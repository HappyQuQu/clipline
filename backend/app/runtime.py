"""Single-container supervisor: migrate first, then manage API and worker process groups."""

import logging
import os
import signal
import subprocess
import sys
import threading
import time

from app.bootstrap import bootstrap
from app.core.config import AppConfig

logger = logging.getLogger(__name__)


def signal_group(process: subprocess.Popen, signum: int) -> None:
    try:
        os.killpg(process.pid, signum)
    except ProcessLookupError:
        pass


def shutdown(children: list[subprocess.Popen], grace_seconds: float) -> None:
    for child in children:
        signal_group(child, signal.SIGTERM)
    deadline = time.monotonic() + grace_seconds
    for child in children:
        try:
            child.wait(timeout=max(0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            signal_group(child, signal.SIGKILL)
            child.wait()
    # A child may have exited while its own media children were still alive.
    for child in children:
        signal_group(child, signal.SIGKILL)


def supervise(config: AppConfig, stopped: threading.Event) -> int:
    commands = [
        [sys.executable, "-m", "app.worker"],
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            str(config.port),
        ],
    ]
    children = []
    try:
        for command in commands:
            children.append(subprocess.Popen(command, start_new_session=True))
        while not stopped.wait(0.2):
            if any(child.poll() is not None for child in children):
                logger.error("A required process exited; stopping container for Docker restart")
                return 1
        return 0
    finally:
        shutdown(children, config.shutdown_grace_seconds)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    config = AppConfig()
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    bootstrap(config)
    if not stopped.is_set():
        raise SystemExit(supervise(config, stopped))


if __name__ == "__main__":
    main()
