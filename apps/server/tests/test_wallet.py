"""账务核心：冻结不超余额、幂等入账、settle/release。"""
import uuid

import pytest
from sqlalchemy import func, select

from app.errors import ApiError
from app.models import Wallet, WalletLedger
from app.services import wallet as ws


async def _wallet(db, user_id) -> Wallet:
    return await db.get(Wallet, user_id, populate_existing=True)


async def test_grant_idempotent_replay(db, user):
    entry1 = await ws.grant(db, user.id, 100, "signup_bonus", str(user.id), reason="注册赠送")
    await db.commit()
    entry2 = await ws.grant(db, user.id, 100, "signup_bonus", str(user.id), reason="注册赠送")
    await db.commit()

    assert entry2.id == entry1.id  # 重放返回已有记录
    wallet = await _wallet(db, user.id)
    assert wallet.balance_cents == 100
    count = await db.scalar(
        select(func.count()).select_from(WalletLedger).where(WalletLedger.user_id == user.id)
    )
    assert count == 1


async def test_sequential_freeze_cannot_exceed_balance(db, user):
    uid = user.id
    await ws.grant(db, uid, 50, "signup_bonus", str(uid))
    await db.commit()

    t1, t2 = uuid.uuid4(), uuid.uuid4()
    await ws.freeze_for_task(db, uid, t1, 20)
    await ws.freeze_for_task(db, uid, t2, 20)
    await db.commit()

    with pytest.raises(ApiError) as exc:
        await ws.freeze_for_task(db, uid, uuid.uuid4(), 20)
    assert exc.value.code == "insufficient_balance"
    await db.rollback()

    wallet = await _wallet(db, uid)
    assert wallet.balance_cents == 10
    assert wallet.frozen_cents == 40


async def test_settle_consumes_frozen_and_is_idempotent(db, user):
    await ws.grant(db, user.id, 100, "signup_bonus", str(user.id))
    task_id = uuid.uuid4()
    await ws.freeze_for_task(db, user.id, task_id, 40)
    await db.commit()

    entry1 = await ws.settle_for_task(db, user.id, task_id, 40)
    await db.commit()
    entry2 = await ws.settle_for_task(db, user.id, task_id, 40)
    await db.commit()

    assert entry2.id == entry1.id
    wallet = await _wallet(db, user.id)
    assert wallet.balance_cents == 60
    assert wallet.frozen_cents == 0
    spend_count = await db.scalar(
        select(func.count())
        .select_from(WalletLedger)
        .where(WalletLedger.kind == "spend", WalletLedger.source_id == str(task_id))
    )
    assert spend_count == 1


async def test_release_returns_funds_and_is_idempotent(db, user):
    await ws.grant(db, user.id, 100, "signup_bonus", str(user.id))
    task_id = uuid.uuid4()
    await ws.freeze_for_task(db, user.id, task_id, 30)
    await db.commit()

    await ws.release_for_task(db, user.id, task_id, 30)
    await db.commit()
    entry_replay = await ws.release_for_task(db, user.id, task_id, 30)
    await db.commit()

    wallet = await _wallet(db, user.id)
    assert wallet.balance_cents == 100
    assert wallet.frozen_cents == 0
    assert entry_replay.kind == "release"
    release_count = await db.scalar(
        select(func.count())
        .select_from(WalletLedger)
        .where(WalletLedger.kind == "release", WalletLedger.user_id == user.id)
    )
    assert release_count == 1


async def test_admin_adjust_negative_requires_balance(db, user):
    uid = user.id
    await ws.grant(db, uid, 30, "signup_bonus", str(uid))
    await db.commit()

    with pytest.raises(ApiError) as exc:
        await ws.admin_adjust(db, uid, -50, str(uuid.uuid4()), "扣减测试")
    assert exc.value.code == "insufficient_balance"
    await db.rollback()

    await ws.admin_adjust(db, uid, -20, str(uuid.uuid4()), "扣减测试")
    await db.commit()
    wallet = await _wallet(db, uid)
    assert wallet.balance_cents == 10
