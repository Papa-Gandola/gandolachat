"""push tokens table

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "push_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        # ExponentPushToken[xxx...] / ExpoPushToken[xxx...] strings. Unique
        # across the table — same token registered for two users (e.g. after
        # account switch on the device) gets re-pointed to the current user
        # via upsert in the endpoint.
        sa.Column("token", sa.String(255), nullable=False, unique=True),
        sa.Column("platform", sa.String(16), nullable=False, server_default="android"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_push_tokens_user_id", "push_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_push_tokens_user_id", table_name="push_tokens")
    op.drop_table("push_tokens")
