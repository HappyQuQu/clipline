import logging
import shutil
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from app.core.config import AppConfig
from app.core.errors import AppError
from app.core.locks import ProcessLock
from app.core.time import utc_now_ms
from app.db.migrations import require_current_schema
from app.db.models import RuntimeLease
from app.db.session import make_engine
from app.services.exports import export
from app.services.maintenance import run as maintenance_loop
from app.services.playback import prepare
from app.services.scanner import scan
from app.tasks.context import TaskContext
from app.tasks.queue import Cancelled, Interrupted, LeaseLost, Queue

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
                set_={"owner": owner, "token": token, "expires_at": statement.excluded.expires_at},
            )
        )


def execute(queue, claim, stopped):
    context = TaskContext(queue, claim, stopped)
    try:
        result, finalize = {"prepare": prepare, "export": export, "scan": scan, "reindex": scan}[
            claim.kind
        ](context)
        queue.settle(claim, result=result, finalize=finalize)
    except Cancelled:
        queue.settle(claim)
    except Interrupted:
        queue.settle(claim, shutdown=True)
    except LeaseLost:
        raise
    except AppError as error:
        queue.settle(claim, error=error)
    except Exception:
        logger.exception("Task failed unexpectedly: %s", claim.task_id)
        queue.settle(
            claim, error=AppError("TASK_EXECUTION_ERROR", "后台处理失败，请查看日志后重试。")
        )
    finally:
        temporary = queue.config.data / "tmp" / claim.task_id / claim.token
        if temporary.resolve().is_relative_to(queue.config.data / "tmp"):
            shutil.rmtree(temporary, ignore_errors=True)


def run(config: AppConfig, stopped: threading.Event) -> None:
    engine = make_engine(config)
    owner, token = str(uuid4()), str(uuid4())
    queue = Queue(engine, config, owner)
    pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="media-index")
    futures = {}
    try:
        require_current_schema(engine)
        with ProcessLock(config.data / "worker.lock"):
            try:
                queue.recover()
                maintenance = threading.Thread(
                    target=maintenance_loop,
                    args=(engine, config, stopped),
                    name="maintenance",
                    daemon=True,
                )
                maintenance.start()
                logger.info("Indexing worker started")
                next_heartbeat = next_schedule = 0
                while not stopped.is_set():
                    now = time.monotonic()
                    if now >= next_heartbeat:
                        heartbeat(engine, owner, token, config.worker_lease_seconds)
                        queue.renew()
                        next_heartbeat = now + config.heartbeat_interval_seconds
                    if now >= next_schedule:
                        queue.schedule()
                        next_schedule = now + config.scheduler_interval_seconds
                    for task_id, future in list(futures.items()):
                        if future.done():
                            future.result()
                            del futures[task_id]
                    while len(futures) < 3:
                        claim = queue.claim()
                        if claim is None:
                            break
                        futures[claim.task_id] = pool.submit(execute, queue, claim, stopped)
                    stopped.wait(config.worker_poll_seconds)
            finally:
                stopped.set()
                pool.shutdown(wait=True, cancel_futures=False)
                if "maintenance" in locals():
                    maintenance.join()
                with Session(engine) as session, session.begin():
                    session.execute(
                        delete(RuntimeLease).where(
                            RuntimeLease.resource_key == "coordinator", RuntimeLease.token == token
                        )
                    )
    finally:
        pool.shutdown(wait=True, cancel_futures=False)
        engine.dispose()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    run(AppConfig(), stopped)


if __name__ == "__main__":
    main()
