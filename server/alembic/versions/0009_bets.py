"""ставки Гандолиума (⛽ на катки друзей: победа, убийства, рошаны, стрик)

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bettor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("season", sa.String(7), nullable=False),
        sa.Column("market", sa.String(10), nullable=False),
        sa.Column("side", sa.String(6), nullable=False),
        sa.Column("line", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stake", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(8), nullable=False, server_default="open"),
        sa.Column("match_id", sa.BigInteger(), nullable=True),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payout", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("placed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_bets_bettor_id", "bets", ["bettor_id"])
    op.create_index("ix_bets_target_id", "bets", ["target_id"])
    op.create_index("ix_bets_season", "bets", ["season"])
    op.create_index("ix_bets_status", "bets", ["status"])
    # Одна ОТКРЫТАЯ ставка на пару (ставящий, цель) — щит от гонки двух
    # параллельных POST /bets (обе проходят select-проверку до коммита)
    op.create_index(
        "uq_bets_open_pair", "bets", ["bettor_id", "target_id"],
        unique=True, postgresql_where=sa.text("status = 'open'"),
    )


def downgrade() -> None:
    op.drop_index("uq_bets_open_pair", table_name="bets")
    op.drop_index("ix_bets_status", table_name="bets")
    op.drop_index("ix_bets_season", table_name="bets")
    op.drop_index("ix_bets_target_id", table_name="bets")
    op.drop_index("ix_bets_bettor_id", table_name="bets")
    op.drop_table("bets")
