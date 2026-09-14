"""опросы (со своими вариантами) + закрепы сообщений

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "polls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("chat_id", sa.Integer(), sa.ForeignKey("chats.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("question", sa.String(300), nullable=False),
        sa.Column("allow_multi", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("allow_add", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_polls_chat_id", "polls", ["chat_id"])

    op.create_table(
        "poll_options",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("poll_id", sa.Integer(), sa.ForeignKey("polls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.String(100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_index("ix_poll_options_poll_id", "poll_options", ["poll_id"])

    op.create_table(
        "poll_votes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("poll_id", sa.Integer(), sa.ForeignKey("polls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("option_id", sa.Integer(), sa.ForeignKey("poll_options.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("voted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("option_id", "user_id", name="uq_poll_vote"),
    )
    op.create_index("ix_poll_votes_poll_id", "poll_votes", ["poll_id"])
    op.create_index("ix_poll_votes_option_id", "poll_votes", ["option_id"])
    op.create_index("ix_poll_votes_user_id", "poll_votes", ["user_id"])

    op.create_table(
        "pinned_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("chat_id", sa.Integer(), sa.ForeignKey("chats.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pinned_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("chat_id", "message_id", name="uq_pin"),
    )
    op.create_index("ix_pinned_messages_chat_id", "pinned_messages", ["chat_id"])


def downgrade() -> None:
    op.drop_index("ix_pinned_messages_chat_id", table_name="pinned_messages")
    op.drop_table("pinned_messages")
    op.drop_index("ix_poll_votes_user_id", table_name="poll_votes")
    op.drop_index("ix_poll_votes_option_id", table_name="poll_votes")
    op.drop_index("ix_poll_votes_poll_id", table_name="poll_votes")
    op.drop_table("poll_votes")
    op.drop_index("ix_poll_options_poll_id", table_name="poll_options")
    op.drop_table("poll_options")
    op.drop_index("ix_polls_chat_id", table_name="polls")
    op.drop_table("polls")
