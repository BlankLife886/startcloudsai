"""订单完成：条件更新 + 幂等入账，同事务。"""
import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import Notification, Order, utcnow
from app.services import wallet


async def complete_order(db: AsyncSession, order: Order) -> Order:
    """完成订单：pending/paid → completed，入账 grant+bonus（幂等）。

    已 completed 的订单视为幂等重放，直接返回成功，不重复入账
    （ledger 幂等键 ('grant','order',order_id) 双保险）。
    """
    if order.status == "completed":
        return order
    result = await db.execute(
        update(Order)
        .where(Order.id == order.id, Order.status.in_(("pending", "paid")))
        .values(status="completed", completed_at=utcnow(), paid_at=order.paid_at or utcnow())
    )
    if result.rowcount == 0:
        await db.refresh(order)
        if order.status == "completed":
            return order
        raise ApiError("order_not_payable", "订单当前状态不可完成", 400)
    total = order.grant_cents + order.bonus_cents
    await wallet.grant(
        db,
        order.user_id,
        total,
        source_type="order",
        source_id=str(order.id),
        reason=f"订单入账（含赠送 {order.bonus_cents} 分）",
    )
    db.add(
        Notification(
            user_id=order.user_id,
            kind="order",
            title="充值到账",
            body=f"订单已完成，{total} 分已入账到你的钱包。",
        )
    )
    await db.refresh(order)
    return order
