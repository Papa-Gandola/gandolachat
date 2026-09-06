"""compendium: steam link on users, compendium flag on chats,
dota_matches / compendium_profiles / quest_completions tables

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- users: Steam / Dota link ---
    op.add_column("users", sa.Column("steam_id64", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("dota_account_id", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("dota_rank_tier", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("dota_leaderboard_rank", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("dota_rank_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("dota_linked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_dota_account_id", "users", ["dota_account_id"])

    # --- chats: where the poller posts quest cards ---
    op.add_column(
        "chats",
        sa.Column("compendium_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )

    # --- processed ranked matches ---
    op.create_table(
        "dota_matches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("season", sa.String(7), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hero_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_win", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_radiant", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("kills", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deaths", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("assists", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("gpm", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("xpm", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_hits", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("denies", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hero_damage", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tower_damage", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hero_healing", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hero_level", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("net_worth", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wards_placed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("camps_stacked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("runes_picked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("multi_kill_max", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("kill_streak_max", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("firstblood", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("lane_role", sa.Integer(), nullable=True),
        sa.Column("team_key", sa.String(120), nullable=True),
        sa.Column("team_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_parsed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("parse_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("data", sa.Text(), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("match_id", "user_id", name="uq_dota_match_user"),
    )
    op.create_index("ix_dota_matches_match_id", "dota_matches", ["match_id"])
    op.create_index("ix_dota_matches_user_id", "dota_matches", ["user_id"])
    op.create_index("ix_dota_matches_season", "dota_matches", ["season"])

    # --- season wallets ---
    op.create_table(
        "compendium_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("season", sa.String(7), nullable=False),
        sa.Column("gas", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("start_rank_tier", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "season", name="uq_compendium_user_season"),
    )
    op.create_index("ix_compendium_profiles_user_id", "compendium_profiles", ["user_id"])
    op.create_index("ix_compendium_profiles_season", "compendium_profiles", ["season"])

    # --- earned quests ---
    op.create_table(
        "quest_completions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("season", sa.String(7), nullable=False),
        sa.Column("quest_id", sa.String(40), nullable=False),
        sa.Column("period_key", sa.String(20), nullable=False),
        sa.Column("gas", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("match_id", sa.BigInteger(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "quest_id", "period_key", name="uq_quest_period"),
    )
    op.create_index("ix_quest_completions_user_id", "quest_completions", ["user_id"])
    op.create_index("ix_quest_completions_season", "quest_completions", ["season"])
    op.create_index("ix_quest_completions_quest_id", "quest_completions", ["quest_id"])


def downgrade() -> None:
    op.drop_index("ix_quest_completions_quest_id", table_name="quest_completions")
    op.drop_index("ix_quest_completions_season", table_name="quest_completions")
    op.drop_index("ix_quest_completions_user_id", table_name="quest_completions")
    op.drop_table("quest_completions")
    op.drop_index("ix_compendium_profiles_season", table_name="compendium_profiles")
    op.drop_index("ix_compendium_profiles_user_id", table_name="compendium_profiles")
    op.drop_table("compendium_profiles")
    op.drop_index("ix_dota_matches_season", table_name="dota_matches")
    op.drop_index("ix_dota_matches_user_id", table_name="dota_matches")
    op.drop_index("ix_dota_matches_match_id", table_name="dota_matches")
    op.drop_table("dota_matches")
    op.drop_column("chats", "compendium_enabled")
    op.drop_index("ix_users_dota_account_id", table_name="users")
    op.drop_column("users", "dota_linked_at")
    op.drop_column("users", "dota_rank_updated_at")
    op.drop_column("users", "dota_leaderboard_rank")
    op.drop_column("users", "dota_rank_tier")
    op.drop_column("users", "dota_account_id")
    op.drop_column("users", "steam_id64")
