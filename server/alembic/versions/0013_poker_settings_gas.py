"""покер: настройки стола, режим «за газ» с ре-энтри

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("poker_tables", sa.Column("mode", sa.String(8), nullable=False, server_default="chips"))
    op.add_column("poker_tables", sa.Column("entry_gas", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("poker_tables", sa.Column("max_reentries", sa.Integer(), nullable=False, server_default="2"))
    op.add_column("poker_tables", sa.Column("reentry_until_level", sa.Integer(), nullable=False, server_default="3"))
    op.add_column("poker_tables", sa.Column("gas_pot", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("poker_seats", sa.Column("reentries", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("poker_seats", sa.Column("gas_paid", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("poker_seats", "gas_paid")
    op.drop_column("poker_seats", "reentries")
    op.drop_column("poker_tables", "gas_pot")
    op.drop_column("poker_tables", "reentry_until_level")
    op.drop_column("poker_tables", "max_reentries")
    op.drop_column("poker_tables", "entry_gas")
    op.drop_column("poker_tables", "mode")
