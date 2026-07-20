"""Worker 任务执行：领取 → 调上游 → 传 R2 → 结算/解冻。"""
import base64
import logging
import uuid
from datetime import timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models import Session as DbSession, Task, ensure_utc, utcnow
from app.services import settings_service, storage, task_service
from app.services.c2a_client import C2ANetworkError, C2AUpstreamError, edit_images, generate_images
from app.services.prompt_compiler import compile_prompt

logger = logging.getLogger("app.worker")

ZOMBIE_RUNNING_MINUTES = 30


async def _claim_task(db: AsyncSession, task_id: uuid.UUID) -> Task | None:
    """条件更新 queued→running，抢不到返回 None。"""
    result = await db.execute(
        update(Task)
        .where(Task.id == task_id, Task.status == "queued")
        .values(status="running", started_at=utcnow())
    )
    if result.rowcount == 0:
        return None
    await db.commit()
    return await db.get(Task, task_id)


async def _bump_attempt(task_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        await db.execute(update(Task).where(Task.id == task_id).values(attempt=Task.attempt + 1))
        await db.commit()


async def _load_input_images_b64(input_keys: list[str]) -> list[str]:
    images = []
    for key in input_keys:
        data = await storage.get_bytes(key)
        images.append(base64.b64encode(data).decode("ascii"))
    return images


async def _call_upstream(task: Task, model: str) -> list[str]:
    final_prompt, size = compile_prompt(task.type, task.prompt, task.params)
    if task.input_keys:
        inputs = await _load_input_images_b64(list(task.input_keys))
        return await edit_images(final_prompt, model, task.count, inputs, size=size)
    return await generate_images(final_prompt, model, task.count, size=size)


async def run_task(ctx: dict, task_id: str) -> str:
    tid = uuid.UUID(task_id)
    async with SessionLocal() as db:
        task = await _claim_task(db, tid)
    if task is None:
        logger.info("task %s not claimable, skip", task_id)
        return "skipped"

    async with SessionLocal() as db:
        model = await settings_service.get_task_model(db, task.type)

    error_code, error_message = "internal_error", "未知错误"
    images_b64: list[str] | None = None
    try:
        try:
            images_b64 = await _call_upstream(task, model)
        except C2ANetworkError as exc:
            # 连接/超时类错误重试一次
            logger.warning("task %s network error, retrying once: %s", task_id, exc)
            await _bump_attempt(tid)
            images_b64 = await _call_upstream(task, model)
    except C2ANetworkError as exc:
        error_code, error_message = "upstream_unreachable", str(exc)
    except C2AUpstreamError as exc:
        error_code, error_message = "upstream_error", str(exc)
    except Exception as exc:
        logger.exception("task %s unexpected error", task_id)
        error_code, error_message = "internal_error", str(exc)

    if images_b64 is not None:
        try:
            output_keys = []
            for i, b64 in enumerate(images_b64):
                key = f"tasks/{task.user_id}/{task.id}/{i}.png"
                await storage.upload_bytes(key, base64.b64decode(b64), "image/png")
                output_keys.append(key)
            async with SessionLocal() as db:
                db_task = await db.get(Task, tid)
                if db_task is not None and await task_service.mark_succeeded(db, db_task, output_keys):
                    await db.commit()
                else:
                    await db.rollback()
            return "succeeded"
        except Exception as exc:
            logger.exception("task %s failed to store outputs", task_id)
            error_code, error_message = "storage_error", str(exc)

    async with SessionLocal() as db:
        db_task = await db.get(Task, tid)
        if db_task is not None and await task_service.mark_failed(
            db, db_task, error_code, (error_message or "")[:2000]
        ):
            await db.commit()
        else:
            await db.rollback()
    return "failed"


async def cleanup_expired_sessions(ctx: dict) -> None:
    """cron：每小时清理过期 session。"""
    async with SessionLocal() as db:
        result = await db.execute(delete(DbSession).where(DbSession.expires_at < utcnow()))
        await db.commit()
    if result.rowcount:
        logger.info("cleaned %s expired sessions", result.rowcount)


async def reap_zombie_tasks(ctx: dict) -> None:
    """cron：每 10 分钟把 running 超过 30 分钟的任务判为 failed 并 release。"""
    threshold = utcnow() - timedelta(minutes=ZOMBIE_RUNNING_MINUTES)
    async with SessionLocal() as db:
        zombie_ids = (
            await db.scalars(
                select(Task.id).where(Task.status == "running", Task.started_at < threshold)
            )
        ).all()
    for task_id in zombie_ids:
        async with SessionLocal() as db:
            task = await db.get(Task, task_id)
            if task is None or ensure_utc(task.started_at) is None:
                continue
            if await task_service.mark_failed(db, task, "timeout", "任务执行超时，已自动回收"):
                await db.commit()
                logger.warning("reaped zombie task %s", task_id)
            else:
                await db.rollback()
