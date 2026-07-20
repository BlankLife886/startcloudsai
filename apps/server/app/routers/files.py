"""文件读取：校验属主后 302 到 R2 presigned URL。"""
from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy import cast, select, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.errors import ApiError
from app.models import GallerySubmission, User
from app.services import storage

router = APIRouter(prefix="/api/files", tags=["files"])


async def _is_public_gallery_key(db: AsyncSession, key: str) -> bool:
    """key 是否属于已过审投稿的 media_keys/cover_key。"""
    stmt = select(GallerySubmission.id).where(
        GallerySubmission.status == "approved",
        (GallerySubmission.cover_key == key)
        | cast(GallerySubmission.media_keys, String).like(f'%"{key}"%'),
    ).limit(1)
    return (await db.scalar(stmt)) is not None


@router.get("/{key:path}")
async def get_file(key: str, user: User | None = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    key = key.strip("/")
    if not key or ".." in key:
        raise ApiError("not_found", "文件不存在", 404)

    allowed = False
    if user is not None and user.role == "admin":
        allowed = True
    elif user is not None and (
        key.startswith(f"uploads/{user.id}/") or key.startswith(f"tasks/{user.id}/")
    ):
        allowed = True
    elif await _is_public_gallery_key(db, key):
        allowed = True

    if not allowed:
        if user is None:
            raise ApiError("auth_required", "请先登录", 401)
        raise ApiError("not_found", "文件不存在", 404)

    return RedirectResponse(storage.presign_get(key), status_code=302)
