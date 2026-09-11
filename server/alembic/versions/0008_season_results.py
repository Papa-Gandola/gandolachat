"""итоги сезонов Гандолиума (финал: подиум, рамки, архив)

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "season_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("season", sa.String(7), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("place", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(50), nullable=False),
        sa.Column("gas", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("quests_done", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("anti_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("season", "user_id", name="uq_season_user"),
    )
    op.create_index("ix_season_results_season", "season_results", ["season"])
    op.create_index("ix_season_results_user_id", "season_results", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_season_results_user_id", table_name="season_results")
    op.drop_index("ix_season_results_season", table_name="season_results")
    op.drop_table("season_results")
