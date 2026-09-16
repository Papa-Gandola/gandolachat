"""приз чемпиону сезона: пул призов + розыгрыш на сезон

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "season_prizes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("hint1", sa.String(200), nullable=True),
        sa.Column("hint2", sa.String(200), nullable=True),
        sa.Column("hint3", sa.String(200), nullable=True),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "season_prize_draws",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("season", sa.String(7), nullable=False, unique=True, index=True),
        sa.Column("prize_id", sa.Integer(), sa.ForeignKey("season_prizes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("hint1", sa.String(200), nullable=True),
        sa.Column("hint2", sa.String(200), nullable=True),
        sa.Column("hint3", sa.String(200), nullable=True),
        sa.Column("drawn_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("drawn_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("revealed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("winner_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("winner_username", sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("season_prize_draws")
    op.drop_table("season_prizes")
