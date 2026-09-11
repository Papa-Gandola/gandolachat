"""уровень = пик лучшего сезона (падает с проигранным газом)

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-11

Решение хозяина: comp_max_level больше не «вечный максимум навсегда», а
уровень ЛУЧШЕГО сезона по текущему газу профилей — проигранные в ставках
⛽ опускают его (и открытую уровнем косметику). Прошлые сезоны заморожены,
их вклад не сгорает. Тут — единоразовый пересчёт под новую семантику
(до ставок газ никогда не убывал, так что значения фактически совпадут).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE users u SET comp_max_level = COALESCE(
            (SELECT FLOOR(MAX(p.gas) / 100.0) + 1
             FROM compendium_profiles p
             WHERE p.user_id = u.id AND p.gas > 0),
            0
        )
        """
    )


def downgrade() -> None:
    pass  # пересчёт необратим и безвреден
