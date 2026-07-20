"""任务：提交 / 列表 / 详情 / 取消 / 删除。"""
import logging
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_user
from app.errors import ApiError, ok
from app.models import GallerySubmission, Task, TASK_STATUSES, TASK_TYPES, User
from app.pagination import apply_cursor, build_page
from app.schemas import TaskCreate
from app.serializers import task_dict
from app.services import storage, task_service
from app.services.queue import enqueue_task

logger = logging.getLogger("app.tasks")

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def output_urls_for(task: Task) -> list[str]:
    urls = []
    for key in task.output_keys or []:
        try:
            urls.append(storage.presign_get(key))
        except Exception:
            logger.warning("presign failed for key %s", key)
    return urls


@router.post("")
async def create_task(body: TaskCreate, user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    for key in body.input_keys:
        if not key.startswith(f"uploads/{user.id}/") and not key.startswith(f"tasks/{user.id}/"):
            raise ApiError("validation_error", "inputKeys 只能引用自己的文件", 422)
    task, created = await task_service.create_task(
        db,
        user.id,
        task_type=body.type,
        prompt=body.prompt,
        params=body.params,
        input_keys=body.input_keys,
        count=body.count,
        idempotency_key=body.idempotency_key,
    )
    await db.commit()
    if created:
        await enqueue_task(str(task.id))
    return ok(task_dict(task, output_urls_for(task)))


@router.get("")
async def list_tasks(
    type: str | None = None,
    status: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Task).where(Task.user_id == user.id)
    if type:
        if type not in TASK_TYPES:
            raise ApiError("validation_error", "无效的任务类型", 422)
        stmt = stmt.where(Task.type == type)
    if status:
        if status not in TASK_STATUSES:
            raise ApiError("validation_error", "无效的任务状态", 422)
        stmt = stmt.where(Task.status == status)
    rows = (await db.scalars(apply_cursor(stmt, Task, cursor, limit))).all()
    return ok(build_page(list(rows), limit, lambda t: task_dict(t, output_urls_for(t))))


async def _get_own_task(db: AsyncSession, user: User, task_id: uuid.UUID) -> Task:
    task = await db.scalar(select(Task).where(Task.id == task_id, Task.user_id == user.id))
    if task is None:
        raise ApiError("task_not_found", "任务不存在", 404)
    return task


@router.get("/{task_id}")
async def get_task(task_id: uuid.UUID, user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    task = await _get_own_task(db, user, task_id)
    return ok(task_dict(task, output_urls_for(task)))


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: uuid.UUID, user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    task = await task_service.cancel_task(db, user.id, task_id)
    await db.commit()
    return ok(task_dict(task))


@router.delete("/{task_id}")
async def delete_task(task_id: uuid.UUID, user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    task = await _get_own_task(db, user, task_id)
    if task.status not in ("succeeded", "failed", "canceled"):
        raise ApiError("task_not_cancelable", "仅已结束的任务可以删除", 400)
    keys = list(task.output_keys or [])
    submission = await db.scalar(select(GallerySubmission).where(GallerySubmission.task_id == task.id))
    if submission is not None:
        await db.delete(submission)
    await db.delete(task)
    await db.commit()
    if keys:
        try:
            await storage.delete_keys(keys)
        except Exception:
            logger.warning("failed to delete R2 keys for task %s", task_id)
    return ok({})
