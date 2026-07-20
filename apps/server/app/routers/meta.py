"""元信息：定价 / 更新说明 / 公告 / 健康检查。"""
from fastapi import APIRouter, Depends
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.errors import ok
from app.models import Announcement, ChangelogEntry, utcnow
from app.serializers import announcement_dict, changelog_dict
from app.services import settings_service

router = APIRouter(tags=["meta"])


@router.get("/api/meta/pricing")
async def pricing(db: AsyncSession = Depends(get_db)):
    prices = await settings_service.get_setting(db, "task_prices") or {}
    free_daily = int(await settings_service.get_setting(db, "free_daily_cents") or 0)
    return ok({"taskPrices": prices, "freeDailyCents": free_daily})


@router.get("/api/meta/changelog")
async def changelog(db: AsyncSession = Depends(get_db)):
    rows = (
        await db.scalars(
            select(ChangelogEntry).order_by(
                ChangelogEntry.date.desc(), ChangelogEntry.sort.desc(), ChangelogEntry.created_at.desc()
            )
        )
    ).all()
    return ok({"items": [changelog_dict(c) for c in rows]})


@router.get("/api/meta/announcements")
async def announcements(db: AsyncSession = Depends(get_db)):
    now = utcnow()
    rows = (
        await db.scalars(
            select(Announcement)
            .where(
                Announcement.active.is_(True),
                or_(Announcement.starts_at.is_(None), Announcement.starts_at <= now),
                or_(Announcement.ends_at.is_(None), Announcement.ends_at >= now),
            )
            .order_by(Announcement.created_at.desc())
        )
    ).all()
    return ok({"items": [announcement_dict(a) for a in rows]})


@router.get("/api/health")
async def health():
    return ok({"status": "ok"})
