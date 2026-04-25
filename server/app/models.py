from datetime import datetime, timedelta, timezone
from sqlalchemy import String, Boolean, ForeignKey, DateTime, Text, Integer, Table, Column
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
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    messages: Mapped[list["Message"]] = relationship(back_populates="sender", cascade="all, delete-orphan")
    chats: Mapped[list["Chat"]] = relationship(secondary=chat_members, back_populates="members")


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_group: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

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
