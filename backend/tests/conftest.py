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
