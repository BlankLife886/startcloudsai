"""订单与支付回调。"""
import hmac
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import require_user
from app.errors import ApiError, ok
from app.models import Order, Plan, User
from app.pagination import apply_cursor, build_page
from app.schemas import MockWebhookIn, OrderCreate
from app.serializers import order_dict
from app.services.order_service import complete_order

router = APIRouter(tags=["orders"])


@router.post("/api/orders")
async def create_order(body: OrderCreate, user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    plan = await db.scalar(select(Plan).where(Plan.id == body.plan_id, Plan.active.is_(True)))
    if plan is None:
        raise ApiError("plan_not_found", "套餐不存在或已下架", 404)
    order = Order(
        user_id=user.id,
        plan_id=plan.id,
        amount_cents=plan.price_cents,
        grant_cents=plan.grant_cents,
        bonus_cents=plan.bonus_cents,
        provider="mock",
    )
    db.add(order)
    await db.commit()
    # mock 渠道无真实收银台，payUrl 为空；由 mock webhook 或后台补单完成
    return ok(order_dict(order, pay_url=None))


@router.get("/api/orders")
async def list_orders(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = apply_cursor(select(Order).where(Order.user_id == user.id), Order, cursor, limit)
    rows = (await db.scalars(stmt)).all()
    return ok(build_page(list(rows), limit, order_dict))


@router.get("/api/orders/{order_id}")
async def get_order(order_id: uuid.UUID, user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    order = await db.scalar(select(Order).where(Order.id == order_id, Order.user_id == user.id))
    if order is None:
        raise ApiError("order_not_found", "订单不存在", 404)
    return ok(order_dict(order))


@router.post("/api/payments/webhook/{provider}")
async def payment_webhook(provider: str, body: MockWebhookIn, db: AsyncSession = Depends(get_db)):
    if provider != "mock":
        raise ApiError("not_found", "不支持的支付渠道", 404)
    if not hmac.compare_digest(body.secret, get_settings().app_secret):
        raise ApiError("auth_required", "webhook 校验失败", 401)
    order = await db.get(Order, body.order_id)
    if order is None:
        raise ApiError("order_not_found", "订单不存在", 404)
    order = await complete_order(db, order)
    await db.commit()
    return ok(order_dict(order))
