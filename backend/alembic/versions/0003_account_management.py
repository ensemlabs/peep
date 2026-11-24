"""account management: token limits, token usage ledger, admin audit log

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

NOW = sa.text("now()")


def upgrade() -> None:
    op.add_column("users", sa.Column("token_limit", sa.BigInteger))
    op.add_column("users", sa.Column("token_period", sa.String(8), nullable=False, server_default="month"))
    op.create_check_constraint("ck_users_token_limit", "users", "token_limit > 0")
    op.create_check_constraint("ck_users_token_period", "users", "token_period IN ('day','month')")

    op.create_table(
        "token_usage",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("user_id", sa.Uuid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.Uuid, sa.ForeignKey("messages.id", ondelete="SET NULL")),
        sa.Column("tokens", sa.BigInteger, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
    )
    op.create_index("ix_token_usage_user_created", "token_usage", ["user_id", "created_at"])
    op.create_index("ix_token_usage_message", "token_usage", ["message_id"])

    op.create_table(
        "admin_audit",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("actor_id", sa.Uuid, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("actor_email", sa.String(254), nullable=False),
        sa.Column("target_id", sa.Uuid),
        sa.Column("target_email", sa.String(254)),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("detail", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
    )
    op.create_index("ix_admin_audit_created", "admin_audit", [sa.text("created_at DESC")])
    op.create_index("ix_admin_audit_target", "admin_audit", ["target_id"])
    op.create_index("ix_admin_audit_actor", "admin_audit", ["actor_id"])


def downgrade() -> None:
    op.drop_table("admin_audit")
    op.drop_table("token_usage")
    op.drop_constraint("ck_users_token_period", "users", type_="check")
    op.drop_constraint("ck_users_token_limit", "users", type_="check")
    op.drop_column("users", "token_period")
    op.drop_column("users", "token_limit")
