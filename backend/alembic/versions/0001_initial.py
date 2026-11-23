"""initial schema

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

NOW = sa.text("now()")


def _ts(name: str, nullable: bool = False, default: bool = True) -> sa.Column:
    return sa.Column(
        name, sa.DateTime(timezone=True), nullable=nullable, server_default=NOW if default else None
    )


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("role", sa.String(16), nullable=False, server_default="user"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        _ts("created_at"),
        _ts("updated_at"),
        _ts("last_login_at", nullable=True, default=False),
        _ts("approved_at", nullable=True, default=False),
        sa.Column("approved_by", sa.Uuid, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.CheckConstraint("role IN ('user','admin')", name="ck_users_role"),
        sa.CheckConstraint("status IN ('pending','active','disabled')", name="ck_users_status"),
    )
    op.create_index("uq_users_email_lower", "users", [sa.text("lower(email)")], unique=True)

    op.create_table(
        "sessions",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("user_id", sa.Uuid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.LargeBinary, nullable=False, unique=True),
        _ts("created_at"),
        _ts("last_seen_at"),
        _ts("expires_at", default=False),
        _ts("absolute_expires_at", default=False),
        sa.Column("ip", sa.String(64)),
        sa.Column("user_agent", sa.String(255)),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    op.create_table(
        "auth_throttle",
        sa.Column("key", sa.Text, primary_key=True),
        sa.Column("fail_count", sa.Integer, nullable=False, server_default="0"),
        _ts("window_start"),
        _ts("locked_until", nullable=True, default=False),
        sa.Column("lock_level", sa.Integer, nullable=False, server_default="0"),
        _ts("updated_at"),
    )

    op.create_table(
        "conversations",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("user_id", sa.Uuid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text, nullable=False, server_default=""),
        sa.Column("model", sa.String(128)),
        _ts("created_at"),
        _ts("updated_at"),
    )
    op.create_index(
        "ix_conversations_user_updated", "conversations", ["user_id", sa.text("updated_at DESC")]
    )

    op.create_table(
        "messages",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column(
            "conversation_id", sa.Uuid, sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text, nullable=False, server_default=""),
        sa.Column("parts", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(16), nullable=False, server_default="complete"),
        sa.Column("model", sa.String(128)),
        sa.Column("error", sa.Text),
        _ts("created_at"),
        _ts("updated_at"),
        sa.CheckConstraint("role IN ('user','assistant')", name="ck_messages_role"),
        sa.CheckConstraint("status IN ('streaming','complete','error','stopped')", name="ck_messages_status"),
    )
    op.create_index("ix_messages_conversation_created", "messages", ["conversation_id", "created_at"])

    op.create_table(
        "files",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("user_id", sa.Uuid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.Uuid, sa.ForeignKey("conversations.id", ondelete="SET NULL")),
        sa.Column("message_id", sa.Uuid, sa.ForeignKey("messages.id", ondelete="SET NULL")),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("mime", sa.String(255), nullable=False),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("size", sa.BigInteger, nullable=False),
        sa.Column("width", sa.Integer),
        sa.Column("height", sa.Integer),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("object_key", sa.Text, nullable=False),
        sa.Column("thumb_key", sa.Text),
        sa.Column("source", sa.String(16), nullable=False, server_default="upload"),
        _ts("created_at"),
        sa.CheckConstraint("kind IN ('image','video','audio','file')", name="ck_files_kind"),
        sa.CheckConstraint("source IN ('upload','generated')", name="ck_files_source"),
    )
    op.create_index("ix_files_user_id", "files", ["user_id"])


def downgrade() -> None:
    for table in ("files", "messages", "conversations", "auth_throttle", "sessions", "users"):
        op.drop_table(table)
