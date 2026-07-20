"""套餐（公开）。"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.errors import ok
from app.models import Plan
from app.serializers import plan_dict

router = APIRouter(prefix="/api/plans", tags=["plans"])


@router.get("")
async def list_plans(db: AsyncSession = Depends(get_db)):
    plans = (
        await db.scalars(select(Plan).where(Plan.active.is_(True)).order_by(Plan.sort, Plan.created_at))
    ).all()
    return ok({"items": [plan_dict(p) for p in plans]})
