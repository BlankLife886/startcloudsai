"""画廊：公开列表 + 投稿管理。"""
import logging
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_user
from app.errors import ApiError, ok
from app.models import GallerySubmission, Task, User
from app.pagination import apply_cursor, build_page
from app.schemas import GallerySubmit
from app.serializers import iso, submission_dict
from app.services import storage

logger = logging.getLogger("app.gallery")

router = APIRouter(tags=["gallery"])


def _presign_safe(key: str | None) -> str | None:
    if not key:
        return None
    try:
        return storage.presign_get(key)
    except Exception:
        logger.warning("presign failed for key %s", key)
        return None


@router.get("/api/gallery")
async def public_gallery(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = apply_cursor(
        select(GallerySubmission).where(GallerySubmission.status == "approved"),
        GallerySubmission,
        cursor,
        limit,
    )
    rows = list((await db.scalars(stmt)).all())
    user_ids = {s.user_id for s in rows}
    users = {}
    if user_ids:
        user_rows = (await db.scalars(select(User).where(User.id.in_(user_ids)))).all()
        users = {u.id: u for u in user_rows}

    def serialize(s: GallerySubmission) -> dict:
        author = users.get(s.user_id)
        return {
            "id": str(s.id),
            "title": s.title,
            "coverUrl": _presign_safe(s.cover_key),
            "mediaUrls": [u for u in (_presign_safe(k) for k in s.media_keys or []) if u],
            "author": {
                "id": str(author.id) if author else None,
                "username": author.username if author else None,
                "avatarUrl": author.avatar_url if author else None,
            },
            "createdAt": iso(s.created_at),
        }

    return ok(build_page(rows, limit, serialize))


@router.post("/api/gallery/submissions")
async def submit(body: GallerySubmit, user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    task = await db.scalar(select(Task).where(Task.id == body.task_id, Task.user_id == user.id))
    if task is None:
        raise ApiError("task_not_found", "任务不存在", 404)
    if task.status != "succeeded" or not task.output_keys:
        raise ApiError("submission_not_allowed", "仅有产物的成功任务可以投稿", 400)
    existing = await db.scalar(select(GallerySubmission).where(GallerySubmission.task_id == task.id))
    if existing is not None:
        raise ApiError("submission_not_allowed", "该任务已投稿过", 409)
    submission = GallerySubmission(
        user_id=user.id,
        task_id=task.id,
        title=body.title,
        cover_key=(task.output_keys or [None])[0],
        media_keys=list(task.output_keys or []),
    )
    db.add(submission)
    await db.commit()
    return ok(submission_dict(submission))


@router.get("/api/me/gallery/submissions")
async def my_submissions(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = apply_cursor(
        select(GallerySubmission).where(GallerySubmission.user_id == user.id),
        GallerySubmission,
        cursor,
        limit,
    )
    rows = (await db.scalars(stmt)).all()
    return ok(
        build_page(
            list(rows),
            limit,
            lambda s: submission_dict(s, [u for u in (_presign_safe(k) for k in s.media_keys or []) if u]),
        )
    )


@router.delete("/api/me/gallery/submissions/{submission_id}")
async def delete_submission(
    submission_id: uuid.UUID, user: User = Depends(require_user), db: AsyncSession = Depends(get_db)
):
    submission = await db.scalar(
        select(GallerySubmission).where(
            GallerySubmission.id == submission_id, GallerySubmission.user_id == user.id
        )
    )
    if submission is None:
        raise ApiError("not_found", "投稿不存在", 404)
    await db.delete(submission)
    await db.commit()
    return ok({})
