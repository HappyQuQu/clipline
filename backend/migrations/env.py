from alembic import context

from app.core.config import AppConfig
from app.db.models import Base
from app.db.session import make_engine


def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    config = AppConfig()
    context.configure(
        url=f"sqlite:///{config.db}", target_metadata=Base.metadata, literal_binds=True
    )
    with context.begin_transaction():
        context.run_migrations()
elif connection := context.config.attributes.get("connection"):
    migrate(connection)
else:
    engine = make_engine(AppConfig())
    try:
        with engine.connect() as connection:
            migrate(connection)
    finally:
        engine.dispose()
