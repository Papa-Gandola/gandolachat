"""web push subscriptions table

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "web_push_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        # The push service endpoint URL. Can exceed 255 chars (Apple / Mozilla
        # endpoints are long), hence Text + unique instead of a String column.
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(255), nullable=False),
        sa.Column("auth", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_web_push_subscriptions_user_id", "web_push_subscriptions", ["user_id"])
    # Unique on endpoint so re-subscribing the same browser upserts instead of
    # piling up duplicate rows. Postgres needs an explicit unique index for a
    # Text column (can't inline UNIQUE on unbounded text in every backend).
    op.create_index(
        "ux_web_push_subscriptions_endpoint", "web_push_subscriptions", ["endpoint"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ux_web_push_subscriptions_endpoint", table_name="web_push_subscriptions")
    op.drop_index("ix_web_push_subscriptions_user_id", table_name="web_push_subscriptions")
    op.drop_table("web_push_subscriptions")
