"""социалка: невидимка «в Доте сейчас» + недельный срез граммар-счётчика

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column(
        "dota_presence_visible", sa.Boolean(), nullable=False, server_default="true"
    ))
    op.add_column("users", sa.Column(
        "grammar_wk_base", sa.Integer(), nullable=False, server_default="0"
    ))


def downgrade() -> None:
    op.drop_column("users", "grammar_wk_base")
    op.drop_column("users", "dota_presence_visible")
