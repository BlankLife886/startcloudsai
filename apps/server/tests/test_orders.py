"""订单完成幂等：重复完成不重复入账。"""
import uuid

from sqlalchemy import func, select

from app.models import Order, Plan, Wallet, WalletLedger
from app.services.order_service import complete_order


async def _make_order(db, user) -> Order:
    plan = Plan(code=f"p-{uuid.uuid4().hex[:6]}", name="基础包", price_cents=990, grant_cents=1000, bonus_cents=200)
    db.add(plan)
    await db.flush()
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
    return order


async def test_complete_order_credits_once(db, user):
    order = await _make_order(db, user)

    completed = await complete_order(db, order)
    await db.commit()
    assert completed.status == "completed"

    # 重复完成：幂等成功，不重复入账
    again = await complete_order(db, order)
    await db.commit()
    assert again.status == "completed"

    wallet = await db.get(Wallet, user.id, populate_existing=True)
    assert wallet.balance_cents == 1200  # grant 1000 + bonus 200，只入账一次
    grant_count = await db.scalar(
        select(func.count())
        .select_from(WalletLedger)
        .where(WalletLedger.kind == "grant", WalletLedger.source_id == str(order.id))
    )
    assert grant_count == 1


async def test_completed_order_not_payable_error_absent(db, user):
    """已完成订单再次 complete 返回原订单（不抛 order_not_payable）。"""
    order = await _make_order(db, user)
    await complete_order(db, order)
    await db.commit()
    result = await complete_order(db, order)
    assert result.id == order.id and result.status == "completed"
