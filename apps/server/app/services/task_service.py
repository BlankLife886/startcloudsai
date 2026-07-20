"""任务提交 / 取消 / 删除 / 结算落库逻辑。"""
import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import Notification, Task, TASK_TYPES, utcnow
from app.services import settings_service, wallet


async def create_task(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    task_type: str,
    prompt: str,
    params: dict,
    input_keys: list[str],
    count: int,
    idempotency_key: str | None,
) -> tuple[Task, bool]:
    """校验 + 冻结 + 建任务（同事务，不 commit）。返回 (task, created)。"""
    if task_type not in TASK_TYPES:
        raise ApiError("validation_error", "不支持的任务类型", 422)
    if not (1 <= count <= 4):
        raise ApiError("validation_error", "count 须在 1-4 之间", 422)

    if idempotency_key:
        existing = await db.scalar(
            select(Task).where(Task.user_id == user_id, Task.idempotency_key == idempotency_key)
        )
        if existing is not None:
            return existing, False

    max_running = int(await settings_service.get_setting(db, "user_max_running_tasks") or 3)
    active_count = await db.scalar(
        select(func.count())
        .select_from(Task)
        .where(Task.user_id == user_id, Task.status.in_(("queued", "running")))
    )
    if (active_count or 0) >= max_running:
        raise ApiError("user_task_limit", f"同时进行中的任务不能超过 {max_running} 个", 429)

    unit_price = await settings_service.get_task_price_cents(db, task_type)
    cost_cents = unit_price * count

    task = Task(
        id=uuid.uuid4(),
        user_id=user_id,
        type=task_type,
        prompt=prompt,
        params=params or {},
        count=count,
        input_keys=input_keys or [],
        cost_cents=cost_cents,
        idempotency_key=idempotency_key,
    )
    db.add(task)
    if cost_cents > 0:
        await wallet.freeze_for_task(db, user_id, task.id, cost_cents, reason=f"任务冻结（{task_type}×{count}）")
    return task, True


async def cancel_task(db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID) -> Task:
    """仅 queued 可取消：条件更新 + release。"""
    task = await db.scalar(select(Task).where(Task.id == task_id, Task.user_id == user_id))
    if task is None:
        raise ApiError("task_not_found", "任务不存在", 404)
    result = await db.execute(
        update(Task)
        .where(Task.id == task_id, Task.status == "queued")
        .values(status="canceled", finished_at=utcnow())
    )
    if result.rowcount == 0:
        raise ApiError("task_not_cancelable", "仅排队中的任务可以取消", 400)
    if task.cost_cents > 0:
        await wallet.release_for_task(db, user_id, task.id, task.cost_cents, reason="任务取消解冻")
    await db.refresh(task)
    return task


async def mark_succeeded(
    db: AsyncSession, task: Task, output_keys: list[str], finished_at: datetime | None = None
) -> bool:
    """running→succeeded + settle，同事务。返回是否抢到状态迁移。"""
    result = await db.execute(
        update(Task)
        .where(Task.id == task.id, Task.status == "running")
        .values(
            status="succeeded",
            output_keys=output_keys,
            finished_at=finished_at or utcnow(),
            error_code=None,
            error_message=None,
        )
    )
    if result.rowcount == 0:
        return False
    if task.cost_cents > 0:
        await wallet.settle_for_task(db, task.user_id, task.id, task.cost_cents)
    db.add(
        Notification(
            user_id=task.user_id,
            kind="task",
            title="任务已完成",
            body=f"你的「{task.type}」任务已生成 {len(output_keys)} 张图片。",
        )
    )
    return True


async def mark_failed(
    db: AsyncSession,
    task: Task,
    error_code: str,
    error_message: str,
    from_status: str = "running",
) -> bool:
    """running→failed + release，同事务。返回是否抢到状态迁移。"""
    result = await db.execute(
        update(Task)
        .where(Task.id == task.id, Task.status == from_status)
        .values(
            status="failed",
            error_code=error_code,
            error_message=(error_message or "")[:2000],
            finished_at=utcnow(),
        )
    )
    if result.rowcount == 0:
        return False
    if task.cost_cents > 0:
        await wallet.release_for_task(db, task.user_id, task.id, task.cost_cents, reason="任务失败解冻")
    db.add(
        Notification(
            user_id=task.user_id,
            kind="task",
            title="任务失败",
            body=f"你的「{task.type}」任务执行失败，费用已退回。",
        )
    )
    return True


async def requeue_task(db: AsyncSession, task_id: uuid.UUID) -> Task:
    """后台重跑失败任务：failed→queued，重新冻结（失败时已解冻），不重复扣费。"""
    task = await db.get(Task, task_id)
    if task is None:
        raise ApiError("task_not_found", "任务不存在", 404)
    result = await db.execute(
        update(Task)
        .where(Task.id == task_id, Task.status == "failed")
        .values(status="queued", error_code=None, error_message=None, started_at=None, finished_at=None)
    )
    if result.rowcount == 0:
        raise ApiError("task_not_cancelable", "仅失败任务可以重新入队", 400)
    if task.cost_cents > 0:
        await wallet.freeze_for_task(db, task.user_id, task.id, task.cost_cents, reason="任务重跑冻结")
    await db.refresh(task)
    return task
