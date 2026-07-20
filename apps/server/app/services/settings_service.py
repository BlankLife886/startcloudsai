"""运营配置（app_settings 表）读写。"""
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting, utcnow

DEFAULTS: dict[str, Any] = {
    "task_prices": {"t2i": 20, "coloring": 30, "ui_design": 30, "model_sheet": 40, "game_art": 30, "puzzle": 10},
    "user_max_running_tasks": 3,
    "signup_bonus_cents": 100,
    "registration_enabled": True,
    "task_models": {"default": "gpt-image-2"},
    "free_daily_cents": 0,
}

ALLOWED_KEYS = set(DEFAULTS.keys())


async def get_setting(db: AsyncSession, key: str) -> Any:
    row = await db.scalar(select(AppSetting).where(AppSetting.key == key))
    if row is None:
        return DEFAULTS.get(key)
    return row.value


async def get_all_settings(db: AsyncSession) -> dict[str, Any]:
    rows = (await db.scalars(select(AppSetting))).all()
    merged = dict(DEFAULTS)
    for row in rows:
        if row.key in ALLOWED_KEYS:
            merged[row.key] = row.value
    return merged


async def set_setting(db: AsyncSession, key: str, value: Any) -> None:
    row = await db.scalar(select(AppSetting).where(AppSetting.key == key))
    if row is None:
        db.add(AppSetting(key=key, value=value, updated_at=utcnow()))
    else:
        row.value = value
        row.updated_at = utcnow()


async def get_task_price_cents(db: AsyncSession, task_type: str) -> int:
    prices = await get_setting(db, "task_prices") or {}
    price = prices.get(task_type)
    if price is None:
        price = DEFAULTS["task_prices"].get(task_type, 0)
    return int(price)


async def get_task_model(db: AsyncSession, task_type: str) -> str:
    models = await get_setting(db, "task_models") or {}
    return str(models.get(task_type) or models.get("default") or "gpt-image-2")
