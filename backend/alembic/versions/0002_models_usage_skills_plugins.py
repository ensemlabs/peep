"""usage, skills, plugins, conversation pin/read state

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

NOW = sa.text("now()")


def upgrade() -> None:
    op.add_column("messages", sa.Column("usage", postgresql.JSONB))
    op.add_column("conversations", sa.Column("pinned", sa.Boolean, nullable=False, server_default=sa.text("false")))
    op.add_column("conversations", sa.Column("last_read_at", sa.DateTime(timezone=True)))
    # existing conversations count as read
    op.execute("UPDATE conversations SET last_read_at = now()")

    op.create_table(
        "skills",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("user_id", sa.Uuid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("version", sa.String(64)),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("size", sa.BigInteger, nullable=False),
        sa.Column("files", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
    )
    op.create_index("uq_skills_user_name", "skills", ["user_id", "name"], unique=True)

    op.create_table(
        "plugins",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("user_id", sa.Uuid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("transport", sa.String(8), nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("headers", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
    )
    op.create_index("uq_plugins_user_name", "plugins", ["user_id", sa.text("lower(name)")], unique=True)


def downgrade() -> None:
    op.drop_table("plugins")
    op.drop_table("skills")
    op.drop_column("conversations", "last_read_at")
    op.drop_column("conversations", "pinned")
    op.drop_column("messages", "usage")
