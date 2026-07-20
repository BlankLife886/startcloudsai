"""请求/响应模型：对外字段 camelCase（alias_generator）。"""
from datetime import datetime
from datetime import date as date_type
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic.alias_generators import to_camel

from app.models import TASK_TYPES


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ---------- auth ----------

class RegisterIn(CamelModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    username: str | None = Field(default=None, max_length=64)


class LoginIn(CamelModel):
    email: EmailStr
    password: str


class PasswordChange(CamelModel):
    old: str
    new: str = Field(min_length=6, max_length=128)


class ProfilePatch(CamelModel):
    username: str | None = Field(default=None, min_length=1, max_length=64)
    avatar_url: str | None = None
    password: PasswordChange | None = None


# ---------- tasks ----------

class TaskCreate(CamelModel):
    type: Literal["t2i", "coloring", "ui_design", "model_sheet", "game_art", "puzzle"]
    prompt: str = Field(min_length=1, max_length=8000)
    params: dict[str, Any] = Field(default_factory=dict)
    input_keys: list[str] = Field(default_factory=list)
    count: int = Field(default=1, ge=1, le=4)
    idempotency_key: str | None = Field(default=None, max_length=128)

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        if v not in TASK_TYPES:
            raise ValueError("invalid task type")
        return v


# ---------- notifications ----------

class NotificationsReadIn(CamelModel):
    ids: list[UUID] | None = None


# ---------- orders / payments ----------

class OrderCreate(CamelModel):
    plan_id: UUID


class MockWebhookIn(CamelModel):
    order_id: UUID
    secret: str


# ---------- gallery ----------

class GallerySubmit(CamelModel):
    task_id: UUID
    title: str | None = Field(default=None, max_length=200)


# ---------- admin ----------

class AdminUserPatch(CamelModel):
    status: Literal["active", "banned"] | None = None
    role: Literal["user", "admin"] | None = None


class WalletAdjustIn(CamelModel):
    delta_cents: int
    reason: str = Field(min_length=1, max_length=500)


class PlanIn(CamelModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    price_cents: int = Field(ge=0)
    grant_cents: int = Field(ge=0)
    bonus_cents: int = Field(default=0, ge=0)
    features: list[str] = Field(default_factory=list)
    active: bool = True
    sort: int = 0


class PlanPatch(CamelModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=128)
    price_cents: int | None = Field(default=None, ge=0)
    grant_cents: int | None = Field(default=None, ge=0)
    bonus_cents: int | None = Field(default=None, ge=0)
    features: list[str] | None = None
    active: bool | None = None
    sort: int | None = None


class GalleryReviewIn(CamelModel):
    action: Literal["approve", "reject", "remove"]
    reason: str | None = Field(default=None, max_length=500)


class AnnouncementIn(CamelModel):
    title: str = Field(min_length=1, max_length=200)
    body: str | None = None
    active: bool = True
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class AnnouncementPatch(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = None
    active: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class ChangelogIn(CamelModel):
    version: str = Field(min_length=1, max_length=32)
    date: date_type
    tag: Literal["feature", "experience"]
    title: str = Field(min_length=1, max_length=200)
    summary: str | None = None
    items: list[str] = Field(default_factory=list)
    highlight: bool = False
    sort: int = 0


class ChangelogPatch(CamelModel):
    version: str | None = Field(default=None, min_length=1, max_length=32)
    date: date_type | None = None
    tag: Literal["feature", "experience"] | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    summary: str | None = None
    items: list[str] | None = None
    highlight: bool | None = None
    sort: int | None = None


class SettingsPut(CamelModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)

    task_prices: dict[str, int] | None = None
    user_max_running_tasks: int | None = Field(default=None, ge=1, le=100)
    signup_bonus_cents: int | None = Field(default=None, ge=0)
    registration_enabled: bool | None = None
    task_models: dict[str, str] | None = None
    free_daily_cents: int | None = Field(default=None, ge=0)
