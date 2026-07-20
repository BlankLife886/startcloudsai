"""任务生命周期账务：提交冻结 / settle / release / 取消 / requeue。"""
import uuid

import pytest
from sqlalchemy import func, select

from app.errors import ApiError
from app.models import Notification, Wallet, WalletLedger
from app.services import task_service, wallet as ws


async def _wallet(db, user_id) -> Wallet:
    return await db.get(Wallet, user_id, populate_existing=True)


async def _funded_task(db, user, balance=200, count=1):
    await ws.grant(db, user.id, balance, "signup_bonus", str(user.id))
    await db.commit()
    task, created = await task_service.create_task(
        db, user.id, task_type="t2i", prompt="测试", params={}, input_keys=[], count=count, idempotency_key=None
    )
    await db.commit()
    assert created
    return task


async def test_create_task_freezes_cost(db, user):
    task = await _funded_task(db, user, balance=100, count=2)
    assert task.cost_cents == 40  # 默认单价 t2i=20 × 2
    wallet = await _wallet(db, user.id)
    assert wallet.balance_cents == 60
    assert wallet.frozen_cents == 40


async def test_create_task_insufficient_balance(db, user):
    await ws.grant(db, user.id, 10, "signup_bonus", str(user.id))
    await db.commit()
    with pytest.raises(ApiError) as exc:
        await task_service.create_task(
            db, user.id, task_type="t2i", prompt="x", params={}, input_keys=[], count=1, idempotency_key=None
        )
    assert exc.value.code == "insufficient_balance"


async def test_create_task_idempotency_key(db, user):
    await ws.grant(db, user.id, 100, "signup_bonus", str(user.id))
    await db.commit()
    task1, created1 = await task_service.create_task(
        db, user.id, task_type="t2i", prompt="x", params={}, input_keys=[], count=1, idempotency_key="k1"
    )
    await db.commit()
    task2, created2 = await task_service.create_task(
        db, user.id, task_type="t2i", prompt="x", params={}, input_keys=[], count=1, idempotency_key="k1"
    )
    await db.commit()
    assert created1 and not created2
    assert task2.id == task1.id
    wallet = await _wallet(db, user.id)
    assert wallet.frozen_cents == 20  # 只冻结一次


async def test_user_task_limit(db, user):
    await ws.grant(db, user.id, 1000, "signup_bonus", str(user.id))
    await db.commit()
    for _ in range(3):  # 默认 user_max_running_tasks = 3
        await task_service.create_task(
            db, user.id, task_type="t2i", prompt="x", params={}, input_keys=[], count=1, idempotency_key=None
        )
        await db.commit()
    with pytest.raises(ApiError) as exc:
        await task_service.create_task(
            db, user.id, task_type="t2i", prompt="x", params={}, input_keys=[], count=1, idempotency_key=None
        )
    assert exc.value.code == "user_task_limit"


async def test_settle_on_success(db, user):
    task = await _funded_task(db, user, balance=100)
    task.status = "running"
    await db.commit()

    assert await task_service.mark_succeeded(db, task, ["tasks/x/0.png"])
    await db.commit()

    wallet = await _wallet(db, user.id)
    assert wallet.balance_cents == 80
    assert wallet.frozen_cents == 0
    # 重复结算（幂等）：状态迁移抢不到
    assert not await task_service.mark_succeeded(db, task, ["tasks/x/0.png"])
    notif = await db.scalar(
        select(func.count()).select_from(Notification).where(Notification.user_id == user.id)
    )
    assert notif == 1


async def test_release_on_failure(db, user):
    task = await _funded_task(db, user, balance=100)
    task.status = "running"
    await db.commit()

    assert await task_service.mark_failed(db, task, "upstream_error", "boom")
    await db.commit()

    wallet = await _wallet(db, user.id)
    assert wallet.balance_cents == 100
    assert wallet.frozen_cents == 0
    assert not await task_service.mark_failed(db, task, "upstream_error", "boom")


async def test_cancel_only_queued(db, user):
    task = await _funded_task(db, user, balance=100)
    canceled = await task_service.cancel_task(db, user.id, task.id)
    await db.commit()
    assert canceled.status == "canceled"
    wallet = await _wallet(db, user.id)
    assert wallet.balance_cents == 100 and wallet.frozen_cents == 0

    with pytest.raises(ApiError) as exc:
        await task_service.cancel_task(db, user.id, task.id)
    assert exc.value.code == "task_not_cancelable"


async def test_requeue_refreezes_then_settles(db, user):
    task = await _funded_task(db, user, balance=100)
    task.status = "running"
    await db.commit()
    await task_service.mark_failed(db, task, "upstream_error", "boom")
    await db.commit()

    requeued = await task_service.requeue_task(db, task.id)
    await db.commit()
    assert requeued.status == "queued"
    wallet = await _wallet(db, user.id)
    assert wallet.balance_cents == 80 and wallet.frozen_cents == 20  # 重新冻结，不重复扣费

    requeued.status = "running"
    await db.commit()
    assert await task_service.mark_succeeded(db, requeued, ["tasks/x/0.png"])
    await db.commit()

    wallet = await _wallet(db, user.id)
    assert wallet.balance_cents == 80 and wallet.frozen_cents == 0
    # 全程只扣一次费：freeze×2 / release×1 / spend×1，净支出 20
    kinds = (
        await db.execute(
            select(WalletLedger.kind, func.count())
            .where(WalletLedger.user_id == user.id, WalletLedger.source_type == "task")
            .group_by(WalletLedger.kind)
        )
    ).all()
    assert dict(kinds) == {"freeze": 2, "release": 1, "spend": 1}
