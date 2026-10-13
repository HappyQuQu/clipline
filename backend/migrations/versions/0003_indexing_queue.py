"""Persistent request aliases and scan generations.

Revision ID: 0003_indexing_queue
Revises: 0002_event_sequence
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_indexing_queue"
down_revision = "0002_event_sequence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sources", sa.Column("revision", sa.Integer(), server_default="1", nullable=False)
    )
    op.add_column("segments", sa.Column("last_seen_scan", sa.String(80), nullable=True))
    op.add_column(
        "tasks", sa.Column("recovery_count", sa.Integer(), server_default="0", nullable=False)
    )
    op.create_table(
        "task_requests",
        sa.Column("scope", sa.String(120), primary_key=True),
        sa.Column("request_key", sa.String(200), primary_key=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response_json", sa.JSON(), nullable=False),
        sa.Column("task_id", sa.String(36), sa.ForeignKey("tasks.id", ondelete="RESTRICT")),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("task_requests")
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("recovery_count")
    with op.batch_alter_table("segments") as batch:
        batch.drop_column("last_seen_scan")
    with op.batch_alter_table("sources") as batch:
        batch.drop_column("revision")
