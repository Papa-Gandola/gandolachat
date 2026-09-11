"""личный чат «Заметки» + напоминания

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chats",
        sa.Column("is_notes", sa.Boolean(), nullable=False, server_default="false"),
    )
    # Один чат «Заметки» на юзера — гонка двух устройств на get-or-create
    # ловится этим индексом (паттерн как с dota_account_id).
    op.create_index(
        "uq_chats_notes_owner", "chats", ["created_by"],
        unique=True, postgresql_where=sa.text("is_notes"),
    )
    op.create_table(
        "reminders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.String(500), nullable=False),
        sa.Column("remind_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fired", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_reminders_user_id", "reminders", ["user_id"])
    op.create_index("ix_reminders_remind_at", "reminders", ["remind_at"])
    # Джоба каждые 30с спрашивает «что созрело» — узкий составной индекс.
    op.create_index("ix_reminders_due", "reminders", ["fired", "remind_at"])


def downgrade() -> None:
    op.drop_index("uq_chats_notes_owner", table_name="chats")
    op.drop_index("ix_reminders_due", table_name="reminders")
    op.drop_index("ix_reminders_remind_at", table_name="reminders")
    op.drop_index("ix_reminders_user_id", table_name="reminders")
    op.drop_table("reminders")
    op.drop_column("chats", "is_notes")
