"""钱包核心：条件 UPDATE + 账本同事务 + 幂等键。

所有函数在调用方事务内执行（不 commit），由调用方保证原子性。
幂等：先查 (kind, source_type, source_id) 是否已有账本记录，有则直接返回
（幂等重放）；并发竞态由 partial unique index 兜底（IntegrityError 由上层
以"重放"语义处理）。

任务冻结/解冻可能因 requeue 发生多轮，账本 source_id 采用「代数」后缀：
第 0 代为 task_id 本身（与文档一致），第 n 代为 "task_id/n"。
spend（结算）全任务生命周期只发生一次，幂等键固定 ('spend','task',task_id)。
"""
import uuid
from typing import Literal

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import Wallet, WalletLedger, utcnow


async def get_wallet(db: AsyncSession, user_id: uuid.UUID) -> Wallet:
    wallet = await db.get(Wallet, user_id)
    if wallet is None:
        raise ApiError("not_found", "钱包不存在", 404)
    return wallet


async def _existing_entry(
    db: AsyncSession, kind: str, source_type: str, source_id: str
) -> WalletLedger | None:
    return await db.scalar(
        select(WalletLedger).where(
            WalletLedger.kind == kind,
            WalletLedger.source_type == source_type,
            WalletLedger.source_id == source_id,
        )
    )


def _add_entry(
    db: AsyncSession,
    user_id: uuid.UUID,
    kind: str,
    delta_cents: int,
    balance_after_cents: int,
    source_type: str,
    source_id: str | None,
    reason: str | None,
) -> WalletLedger:
    entry = WalletLedger(
        user_id=user_id,
        kind=kind,
        delta_cents=delta_cents,
        balance_after_cents=balance_after_cents,
        source_type=source_type,
        source_id=source_id,
        reason=reason,
    )
    db.add(entry)
    return entry


async def grant(
    db: AsyncSession,
    user_id: uuid.UUID,
    amount_cents: int,
    source_type: str,
    source_id: str,
    reason: str | None = None,
    kind: Literal["grant", "refund"] = "grant",
) -> WalletLedger:
    """幂等入账（注册赠送 / 订单入账 / 退款）。"""
    if amount_cents < 0:
        raise ValueError("grant amount must be >= 0")
    existing = await _existing_entry(db, kind, source_type, source_id)
    if existing is not None:
        return existing
    result = await db.execute(
        update(Wallet)
        .where(Wallet.user_id == user_id)
        .values(balance_cents=Wallet.balance_cents + amount_cents, updated_at=utcnow())
        .returning(Wallet.balance_cents)
    )
    row = result.first()
    if row is None:
        raise ApiError("not_found", "钱包不存在", 404)
    return _add_entry(db, user_id, kind, amount_cents, row[0], source_type, source_id, reason)


async def admin_adjust(
    db: AsyncSession,
    user_id: uuid.UUID,
    delta_cents: int,
    source_id: str,
    reason: str,
) -> WalletLedger:
    """人工调整（可正可负），负数时校验余额充足。"""
    existing = await _existing_entry(db, "admin_adjust", "admin", source_id)
    if existing is not None:
        return existing
    stmt = (
        update(Wallet)
        .where(Wallet.user_id == user_id)
        .values(balance_cents=Wallet.balance_cents + delta_cents, updated_at=utcnow())
        .returning(Wallet.balance_cents)
    )
    if delta_cents < 0:
        stmt = stmt.where(Wallet.balance_cents >= -delta_cents)
    result = await db.execute(stmt)
    row = result.first()
    if row is None:
        wallet = await db.get(Wallet, user_id)
        if wallet is None:
            raise ApiError("not_found", "钱包不存在", 404)
        raise ApiError("insufficient_balance", "余额不足，无法扣减", 400)
    return _add_entry(db, user_id, "admin_adjust", delta_cents, row[0], "admin", source_id, reason)


def _task_source_id(task_id: uuid.UUID, generation: int) -> str:
    return str(task_id) if generation == 0 else f"{task_id}/{generation}"


async def _task_generation(db: AsyncSession, task_id: uuid.UUID, kind: str) -> int:
    """该任务已有的同 kind 账本条数（= 下一代序号）。"""
    return (
        await db.scalar(
            select(func.count())
            .select_from(WalletLedger)
            .where(
                WalletLedger.kind == kind,
                WalletLedger.source_type == "task",
                or_(
                    WalletLedger.source_id == str(task_id),
                    WalletLedger.source_id.like(f"{task_id}/%"),
                ),
            )
        )
    ) or 0


async def freeze_for_task(
    db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, amount_cents: int, reason: str | None = None
) -> WalletLedger:
    """冻结任务费用：余额不足抛 insufficient_balance。"""
    gen = await _task_generation(db, task_id, "freeze")
    source_id = _task_source_id(task_id, gen)
    result = await db.execute(
        update(Wallet)
        .where(Wallet.user_id == user_id, Wallet.balance_cents >= amount_cents)
        .values(
            balance_cents=Wallet.balance_cents - amount_cents,
            frozen_cents=Wallet.frozen_cents + amount_cents,
            updated_at=utcnow(),
        )
        .returning(Wallet.balance_cents)
    )
    row = result.first()
    if row is None:
        raise ApiError("insufficient_balance", "余额不足", 400)
    return _add_entry(db, user_id, "freeze", -amount_cents, row[0], "task", source_id, reason)


async def release_for_task(
    db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, amount_cents: int, reason: str | None = None
) -> WalletLedger:
    """解冻（失败/取消）：幂等——本代已 release 则重放返回。"""
    freeze_gen = await _task_generation(db, task_id, "freeze")
    release_gen = await _task_generation(db, task_id, "release")
    if release_gen >= freeze_gen:
        # 每一代 freeze 都已对应 release，幂等重放
        existing = await _existing_entry(
            db, "release", "task", _task_source_id(task_id, max(release_gen - 1, 0))
        )
        if existing is not None:
            return existing
        raise ApiError("internal_error", "任务未冻结，无法解冻", 500)
    source_id = _task_source_id(task_id, release_gen)
    result = await db.execute(
        update(Wallet)
        .where(Wallet.user_id == user_id, Wallet.frozen_cents >= amount_cents)
        .values(
            balance_cents=Wallet.balance_cents + amount_cents,
            frozen_cents=Wallet.frozen_cents - amount_cents,
            updated_at=utcnow(),
        )
        .returning(Wallet.balance_cents)
    )
    row = result.first()
    if row is None:
        raise ApiError("internal_error", "冻结余额异常，无法解冻", 500)
    return _add_entry(db, user_id, "release", amount_cents, row[0], "task", source_id, reason)


async def settle_for_task(
    db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID, amount_cents: int, reason: str | None = None
) -> WalletLedger:
    """结算（成功）：消耗冻结额，幂等键 ('spend','task',task_id)。

    delta_cents = 0：结算只消耗冻结额，可用余额不变（冻结时已记 -amount）。
    """
    existing = await _existing_entry(db, "spend", "task", str(task_id))
    if existing is not None:
        return existing
    result = await db.execute(
        update(Wallet)
        .where(Wallet.user_id == user_id, Wallet.frozen_cents >= amount_cents)
        .values(frozen_cents=Wallet.frozen_cents - amount_cents, updated_at=utcnow())
        .returning(Wallet.balance_cents)
    )
    row = result.first()
    if row is None:
        raise ApiError("internal_error", "冻结余额异常，无法结算", 500)
    return _add_entry(
        db,
        user_id,
        "spend",
        0,
        row[0],
        "task",
        str(task_id),
        reason or f"任务结算：消耗冻结 {amount_cents} 分",
    )
