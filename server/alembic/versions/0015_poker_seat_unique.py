"""покер: одно место на юзера за столом

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-16

Дабл-тап «Сесть» (два запроса join в одну секунду) до этой миграции мог
вставить два места одного юзера за одним столом — и в режиме «за газ»
списать энтри дважды. Сперва чистим дубли (оставляем самое раннее место;
в проде режима «за газ» ещё не было, так что gas_paid у дублей = 0 и терять
нечего), потом уникальность (table_id, user_id).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "DELETE FROM poker_seats a USING poker_seats b "
        "WHERE a.table_id = b.table_id AND a.user_id = b.user_id AND a.id > b.id"
    )
    op.create_unique_constraint("uq_poker_seat_user", "poker_seats", ["table_id", "user_id"])


def downgrade() -> None:
    op.drop_constraint("uq_poker_seat_user", "poker_seats", type_="unique")
