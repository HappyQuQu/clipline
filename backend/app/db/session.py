from sqlalchemy import URL, Engine, create_engine, event

from app.core.config import AppConfig


def make_engine(config: AppConfig) -> Engine:
    engine = create_engine(
        URL.create("sqlite+pysqlite", database=str(config.db)),
        connect_args={"check_same_thread": False, "timeout": 5},
    )

    @event.listens_for(engine, "connect")
    def configure_connection(connection, _):
        from app.services.catalog import clock

        connection.create_function(
            "casefold", 1, lambda value: str(value or "").casefold(), deterministic=True
        )
        connection.create_function("recording_clock", 2, clock, deterministic=True)
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=FULL")
        cursor.close()

    return engine
