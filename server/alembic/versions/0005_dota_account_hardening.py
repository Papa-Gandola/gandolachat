"""dota_account_id: widen to BIGINT + unique index

Свежие steam-аккаунты подбираются к порогу signed int32, а не-уникальный
индекс позволял двум юзерам привязать один дота-аккаунт через гонку —
поллер тогда считал их «командой» в соло-катках.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("users", "dota_account_id", type_=sa.BigInteger(), existing_nullable=True)
    op.drop_index("ix_users_dota_account_id", table_name="users")
    # NULL-ов уникальность не касается (Postgres): отвязанных может быть много
    op.create_index("ix_users_dota_account_id", "users", ["dota_account_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_dota_account_id", table_name="users")
    op.create_index("ix_users_dota_account_id", "users", ["dota_account_id"])
    op.alter_column("users", "dota_account_id", type_=sa.Integer(), existing_nullable=True)
