"""SQLAlchemy 2.0 模型（见 docs/DATABASE.md）。

跨方言兼容：
- email 用 citext（PostgreSQL），SQLite 下降级为 TEXT + 应用层统一小写。
- jsonb 用 JSON().with_variant(JSONB)。
- partial unique index 通过 postgresql_where / sqlite_where 同时声明。
"""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT, JSONB
from sqlalchemy.types import JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(dt: datetime | None) -> datetime | None:
    """SQLite 会丢失 tzinfo，统一补回 UTC 便于比较。"""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


EmailType = Text().with_variant(CITEXT(), "postgresql")
JsonType = JSON().with_variant(JSONB(), "postgresql")

TASK_TYPES = ("t2i", "coloring", "ui_design", "model_sheet", "game_art", "puzzle")
TASK_STATUSES = ("queued", "running", "succeeded", "failed", "canceled")
ORDER_STATUSES = ("pending", "paid", "completed", "failed", "expired")
LEDGER_KINDS = ("grant", "spend", "freeze", "release", "refund", "admin_adjust")
SUBMISSION_STATUSES = ("pending", "approved", "rejected", "removed")


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(EmailType, unique=True, nullable=False)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, nullable=False, default="user", server_default="user")
    status: Mapped[str] = mapped_column(Text, nullable=False, default="active", server_default="active")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("role IN ('user','admin')", name="ck_users_role"),
        CheckConstraint("status IN ('active','banned')", name="ck_users_status"),
    )


class Session(TimestampMixin, Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ip: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("ix_sessions_user_id", "user_id"),)


class Wallet(Base):
    __tablename__ = "wallets"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    balance_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    frozen_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=utcnow)

    __table_args__ = (
        CheckConstraint("balance_cents >= 0", name="ck_wallets_balance_nonneg"),
        CheckConstraint("frozen_cents >= 0", name="ck_wallets_frozen_nonneg"),
    )


class WalletLedger(TimestampMixin, Base):
    __tablename__ = "wallet_ledger"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    delta_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    balance_after_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source_type: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('grant','spend','freeze','release','refund','admin_adjust')",
            name="ck_wallet_ledger_kind",
        ),
        Index("ix_wallet_ledger_user_created", "user_id", "created_at"),
        Index(
            "uq_wallet_ledger_idem",
            "kind",
            "source_type",
            "source_id",
            unique=True,
            postgresql_where=text("source_id IS NOT NULL"),
            sqlite_where=text("source_id IS NOT NULL"),
        ),
    )


class Plan(TimestampMixin, Base):
    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    price_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    grant_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    bonus_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    features: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class Order(TimestampMixin, Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("plans.id"), nullable=False)
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    grant_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    bonus_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending", server_default="pending")
    provider: Mapped[str] = mapped_column(Text, nullable=False, default="mock", server_default="mock")
    provider_order_id: Mapped[str | None] = mapped_column(Text)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','paid','completed','failed','expired')", name="ck_orders_status"
        ),
        Index("ix_orders_user_created", "user_id", "created_at"),
        Index("ix_orders_status", "status"),
        Index(
            "uq_orders_provider_order",
            "provider",
            "provider_order_id",
            unique=True,
            postgresql_where=text("provider_order_id IS NOT NULL"),
            sqlite_where=text("provider_order_id IS NOT NULL"),
        ),
    )


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="queued", server_default="queued")
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    params: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    input_keys: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    output_keys: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    cost_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle')",
            name="ck_tasks_type",
        ),
        CheckConstraint(
            "status IN ('queued','running','succeeded','failed','canceled')", name="ck_tasks_status"
        ),
        CheckConstraint("count >= 1 AND count <= 4", name="ck_tasks_count"),
        Index("ix_tasks_user_created", "user_id", "created_at"),
        Index("ix_tasks_status_created", "status", "created_at"),
        Index(
            "uq_tasks_user_idem",
            "user_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
            sqlite_where=text("idempotency_key IS NOT NULL"),
        ),
    )


class GallerySubmission(TimestampMixin, Base):
    __tablename__ = "gallery_submissions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    title: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending", server_default="pending")
    cover_key: Mapped[str | None] = mapped_column(Text)
    media_keys: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    reject_reason: Mapped[str | None] = mapped_column(Text)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','approved','rejected','removed')",
            name="ck_gallery_submissions_status",
        ),
        Index("ix_gallery_submissions_status_created", "status", "created_at"),
    )


class Notification(TimestampMixin, Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False, default="system", server_default="system")
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)


class NotificationRead(Base):
    __tablename__ = "notification_reads"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    notification_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("notifications.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class Announcement(TimestampMixin, Base):
    __tablename__ = "announcements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChangelogEntry(TimestampMixin, Base):
    __tablename__ = "changelog_entries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    tag: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    items: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    highlight: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    __table_args__ = (
        CheckConstraint("tag IN ('feature','experience')", name="ck_changelog_entries_tag"),
    )


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[dict | list | str | int | bool | None] = mapped_column(JsonType, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=utcnow)
