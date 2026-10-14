from contextlib import contextmanager

from sqlalchemy.orm import Session


@contextmanager
def write_session(engine):
    """Serialize decisions before reads; never hold this transaction during media work."""
    with Session(engine, expire_on_commit=False) as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        try:
            yield session
            session.commit()
        except BaseException:
            session.rollback()
            raise
