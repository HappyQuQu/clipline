import logging
import signal
import threading
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from app.core.config import AppConfig
from app.core.locks import ProcessLock
from app.core.time import utc_now_ms
from app.db.migrations import require_current_schema
from app.db.models import RuntimeLease
from app.db.session import make_engine

logger = logging.getLogger(__name__)


def heartbeat(engine, owner: str, token: str, lease_seconds: float) -> None:
    with Session(engine) as session, session.begin():
        statement = insert(RuntimeLease).values(
            resource_key="coordinator",
            owner=owner,
            token=token,
            expires_at=utc_now_ms() + int(lease_seconds * 1000),
        )
        session.execute(
            statement.on_conflict_do_update(
                index_elements=[RuntimeLease.resource_key],
                set_={
                    "owner": owner,
                    "token": token,
                    "expires_at": statement.excluded.expires_at,
                },
            )
        )


def run(config: AppConfig, stopped: threading.Event) -> None:
    engine = make_engine(config)
    owner, token = str(uuid4()), str(uuid4())
    try:
        require_current_schema(engine)
        with ProcessLock(config.data / "worker.lock"):
            try:
                logger.info("Foundation worker started; task execution is pending D2")
                while not stopped.is_set():
                    heartbeat(engine, owner, token, config.worker_lease_seconds)
                    stopped.wait(config.heartbeat_interval_seconds)
            finally:
                with Session(engine) as session, session.begin():
                    session.execute(
                        delete(RuntimeLease).where(
                            RuntimeLease.resource_key == "coordinator", RuntimeLease.token == token
                        )
                    )
    finally:
        engine.dispose()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    run(AppConfig(), stopped)


if __name__ == "__main__":
    main()
