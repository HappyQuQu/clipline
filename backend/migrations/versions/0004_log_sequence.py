"""Stable log snapshot sequence without changing public UUIDs.

Revision ID: 0004_log_sequence
Revises: 0003_indexing_queue
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_log_sequence"
down_revision = "0003_indexing_queue"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "business_logs_new",
        sa.Column("sequence", sa.Integer(), primary_key=True),
        sa.Column("id", sa.String(36), nullable=False, unique=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("level", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id", ondelete="SET NULL")),
        sa.Column("task_id", sa.String(36), sa.ForeignKey("tasks.id", ondelete="SET NULL")),
        sa.Column("event_code", sa.String(80), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("detail_json", sa.JSON(), nullable=False),
        sqlite_autoincrement=True,
    )
    op.execute(
        "INSERT INTO business_logs_new "
        "(id,created_at,level,kind,source_id,task_id,event_code,title,detail_json) "
        "SELECT id,created_at,level,kind,source_id,task_id,event_code,title,detail_json "
        "FROM business_logs ORDER BY rowid"
    )
    op.drop_table("business_logs")
    op.rename_table("business_logs_new", "business_logs")
    for name, fields in [
        ("ix_logs_time", ["created_at", "id"]),
        ("ix_logs_task_time", ["task_id", "created_at"]),
        ("ix_logs_source_time", ["source_id", "created_at"]),
    ]:
        op.create_index(name, "business_logs", fields)


def downgrade():
    # Downgrade is intentionally offline: restore the migration backup with the old image.
    raise RuntimeError("Restore the pre-upgrade backup together with the matching old image")
