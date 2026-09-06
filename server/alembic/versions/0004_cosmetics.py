"""compendium cosmetics: unlockable badge/title/color/frame + max level on users

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("comp_max_level", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("comp_badge", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("users", sa.Column("comp_title", sa.String(40), nullable=True))
    op.add_column("users", sa.Column("comp_color", sa.String(7), nullable=True))
    op.add_column("users", sa.Column("comp_frame", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "comp_frame")
    op.drop_column("users", "comp_color")
    op.drop_column("users", "comp_title")
    op.drop_column("users", "comp_badge")
    op.drop_column("users", "comp_max_level")
