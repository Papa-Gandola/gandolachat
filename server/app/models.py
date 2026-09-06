from datetime import datetime, timedelta, timezone
from sqlalchemy import String, Boolean, ForeignKey, DateTime, Text, Integer, BigInteger, Table, Column, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

chat_members = Table(
    "chat_members",
    Base.metadata,
    Column("chat_id", Integer, ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("joined_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    about: Mapped[str | None] = mapped_column(String(500), nullable=True)
    grammar_errors: Mapped[int] = mapped_column(default=0)
    is_approved: Mapped[bool] = mapped_column(default=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    # === Steam / Dota link (компендиум + звание в профиле) ===
    # steam_id64 kept as a string: the value exceeds JS Number.MAX_SAFE_INTEGER,
    # so it must travel as a string end-to-end anyway.
    steam_id64: Mapped[str | None] = mapped_column(String(20), nullable=True)
    dota_account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    dota_rank_tier: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dota_leaderboard_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dota_rank_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Matches started before this moment are ignored by the compendium poller —
    # everyone starts collecting from the moment they link, no retro-farming.
    dota_linked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    messages: Mapped[list["Message"]] = relationship(back_populates="sender", cascade="all, delete-orphan")
    chats: Mapped[list["Chat"]] = relationship(secondary=chat_members, back_populates="members")


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_group: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    # Group flag: when False the group becomes a "channel" — only the creator can post,
    # everyone else can read and react. Default True so existing groups stay open.
    allow_all_write: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # JSON-encoded list of user_ids granted admin powers (creator is always implicit owner).
    admin_ids: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Компендиум: quest-completion cards from the Dota poller land in every
    # group that has this flag on (toggled by the creator in group settings).
    compendium_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    members: Mapped[list["User"]] = relationship(secondary=chat_members, back_populates="chats")
    messages: Mapped[list["Message"]] = relationship(back_populates="chat", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_edited: Mapped[bool] = mapped_column(default=False)
    reply_to_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    # When user attaches up to 10 files in one go, every resulting Message gets the
    # same media_group_id so the client can render them together as a mosaic.
    media_group_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)

    reply_to: Mapped["Message | None"] = relationship(remote_side=[id], foreign_keys=[reply_to_id])
    chat: Mapped["Chat"] = relationship(back_populates="messages")
    sender: Mapped["User"] = relationship(back_populates="messages")
    reactions: Mapped[list["Reaction"]] = relationship(back_populates="message", cascade="all, delete-orphan")


class Reaction(Base):
    __tablename__ = "reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    emoji: Mapped[str] = mapped_column(String(10))

    message: Mapped["Message"] = relationship(back_populates="reactions")


# Track last read message per user per chat
read_receipts = Table(
    "read_receipts",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("chat_id", Integer, ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True),
    Column("last_read_message_id", Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
)


# === Poker (sit-and-go Texas Hold'em tournaments) ===
class PokerTable(Base):
    __tablename__ = "poker_tables"

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    # Lifecycle: lobby (waiting to start) | playing | finished
    status: Mapped[str] = mapped_column(String(16), default="lobby")
    starting_stack: Mapped[int] = mapped_column(default=30000)
    starting_small_blind: Mapped[int] = mapped_column(default=100)
    starting_big_blind: Mapped[int] = mapped_column(default=200)
    blind_increase_minutes: Mapped[int] = mapped_column(default=7)
    max_seats: Mapped[int] = mapped_column(default=6)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    seats: Mapped[list["PokerSeat"]] = relationship(back_populates="table", cascade="all, delete-orphan")


class PushToken(Base):
    """Expo push token registered by a mobile client. Multiple tokens per
    user are allowed (multi-device). Same token can only belong to one user
    at a time — re-registration moves it via the endpoint."""
    __tablename__ = "push_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True)
    platform: Mapped[str] = mapped_column(String(16), default="android")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class PokerSeat(Base):
    __tablename__ = "poker_seats"

    id: Mapped[int] = mapped_column(primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("poker_tables.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    seat_index: Mapped[int] = mapped_column()  # 0..max_seats-1
    stack: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)  # false = busted out of tournament
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    table: Mapped["PokerTable"] = relationship(back_populates="seats")


# === Компендиум (Гандолиум): сезонный баттлпас по рейтинговым каткам ===
class DotaMatch(Base):
    """One processed ranked match for one linked user. The quest engine works
    off these rows, so a season's aggregates (streaks, sums, distinct heroes)
    are recomputable at any time. `data` keeps the trimmed OpenDota player
    slice as JSON for parse-only facts (wards, multikills, roles...)."""
    __tablename__ = "dota_matches"
    __table_args__ = (UniqueConstraint("match_id", "user_id", name="uq_dota_match_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(BigInteger, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    season: Mapped[str] = mapped_column(String(7), index=True)  # "2026-09" (МСК)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration: Mapped[int] = mapped_column(default=0)  # seconds
    hero_id: Mapped[int] = mapped_column(default=0)
    is_win: Mapped[bool] = mapped_column(default=False)
    is_radiant: Mapped[bool] = mapped_column(default=True)
    kills: Mapped[int] = mapped_column(default=0)
    deaths: Mapped[int] = mapped_column(default=0)
    assists: Mapped[int] = mapped_column(default=0)
    gpm: Mapped[int] = mapped_column(default=0)
    xpm: Mapped[int] = mapped_column(default=0)
    last_hits: Mapped[int] = mapped_column(default=0)
    denies: Mapped[int] = mapped_column(default=0)
    hero_damage: Mapped[int] = mapped_column(default=0)
    tower_damage: Mapped[int] = mapped_column(default=0)
    hero_healing: Mapped[int] = mapped_column(default=0)
    hero_level: Mapped[int] = mapped_column(default=0)
    net_worth: Mapped[int] = mapped_column(default=0)
    # Replay-parse facts (0 until the parse lands): wards = obs + sentry placed.
    wards_placed: Mapped[int] = mapped_column(default=0)
    camps_stacked: Mapped[int] = mapped_column(default=0)
    runes_picked: Mapped[int] = mapped_column(default=0)
    multi_kill_max: Mapped[int] = mapped_column(default=0)   # 5 = рампага
    kill_streak_max: Mapped[int] = mapped_column(default=0)
    firstblood: Mapped[bool] = mapped_column(default=False)
    lane_role: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1 safe / 2 mid / 3 off / 4 jungle
    # Chat-mates who played this match on the same team: "3-7-12" (sorted user
    # ids, self included) — filled in once a second linked player's row lands.
    team_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    team_size: Mapped[int] = mapped_column(default=0)
    is_parsed: Mapped[bool] = mapped_column(default=False)
    parse_attempts: Mapped[int] = mapped_column(default=0)
    data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: trimmed player slice + match extras
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class CompendiumProfile(Base):
    """Per-user per-season wallet: gas total and the season-start rank baseline
    (for the «Восхождение» marathon). Level is derived: level = gas // 100 + 1."""
    __tablename__ = "compendium_profiles"
    __table_args__ = (UniqueConstraint("user_id", "season", name="uq_compendium_user_season"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    season: Mapped[str] = mapped_column(String(7), index=True)
    gas: Mapped[int] = mapped_column(default=0)
    start_rank_tier: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class QuestCompletion(Base):
    """One earned quest (or anti-achievement / secret). period_key scopes
    repeatability: dailies use the МСК date, weeklies the ISO week, marathons
    the season, per-match repeatables the match_id — a unique constraint keeps
    every (user, quest, period) single-shot."""
    __tablename__ = "quest_completions"
    __table_args__ = (UniqueConstraint("user_id", "quest_id", "period_key", name="uq_quest_period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    season: Mapped[str] = mapped_column(String(7), index=True)
    quest_id: Mapped[str] = mapped_column(String(40), index=True)
    period_key: Mapped[str] = mapped_column(String(20))
    gas: Mapped[int] = mapped_column(default=0)
    match_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
