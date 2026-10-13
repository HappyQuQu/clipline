"""Keep event IDs monotonic after old events are removed.

Revision ID: 0002_event_sequence
Revises: 0001_foundation
"""

from alembic import op

revision = "0002_event_sequence"
down_revision = "0001_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table(
        "events", recreate="always", table_kwargs={"sqlite_autoincrement": True}
    ):
        pass


def downgrade() -> None:
    with op.batch_alter_table("events", recreate="always"):
        pass
