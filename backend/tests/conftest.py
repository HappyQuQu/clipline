import os
import shutil
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from app.bootstrap import bootstrap
from app.core.config import AppConfig
from app.db.session import make_engine
from app.main import create_app


@pytest.fixture
def config(tmp_path):
    recordings = tmp_path / "recordings"
    recordings.mkdir()
    for name in ("alpha", "beta", "gamma", ".hidden"):
        (recordings / name).mkdir()
    (recordings / "not-a-directory.mp4").write_bytes(b"fixture")
    return AppConfig(data=tmp_path / "data", recordings_root=recordings, static_dir=tmp_path / "ui")


@pytest.fixture
def database(config):
    bootstrap(config, check_media=False)
    engine = make_engine(config)
    yield engine
    engine.dispose()


@pytest.fixture
def client(config, database):
    with TestClient(create_app(config)) as client:
        yield client


@pytest.fixture(scope="session")
def video_sample(tmp_path_factory):
    if shutil.which("ffmpeg") is None:
        pytest.skip("FFmpeg is required for media integration tests")
    path = tmp_path_factory.mktemp("synthetic-video") / "sample.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=160x90:r=10",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-pix_fmt",
            "yuv420p",
            "-y",
            str(path),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    return path


@pytest.fixture
def put_video(video_sample):
    def put(directory, name="20261013_091500.mp4"):
        path = directory / name
        shutil.copyfile(video_sample, path)
        os.utime(path, (time.time() - 120, time.time() - 120))
        return path

    return put
