"""users.is_bot — бот с нейросетью (app/ai.py)

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-23

Бот — обычный пользователь с флагом: ЛС с ним = диалог с Gemini, в группах
отвечает на /ai и реплаи. Флаг нужен, чтобы найти его при старте, не
слать ему пуши/звонки и не считать в таблицах.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_bot", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("users", "is_bot")
