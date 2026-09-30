"""октябрь-2026: косметика уровней 13–30 + срез старых максимумов

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-30

1. users.comp_extra (JSON) — косметика новых уровней одним полем:
   {badge_emoji, glow, bubble, custom_title, star}.
2. comp_max_level = LEAST(comp_max_level, 12): до октября уровень считался
   линейкой 100 газа/уровень без потолка (топ сентября — «40-й»), а
   косметика кончалась на 12-м. Новая кривая (engine.level_for_gas) с
   потолком 30 и новые разблокировки 13–30 — цели октября; без среза
   сентябрьские «сороковые» получили бы всё новое даром. Что было открыто
   (≤12) — остаётся.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("comp_extra", sa.JSON(), nullable=True))
    op.execute("UPDATE users SET comp_max_level = 12 WHERE comp_max_level > 12")


def downgrade() -> None:
    op.drop_column("users", "comp_extra")
