"""鉴权依赖：cookie session + Origin 白名单。"""
from datetime import timedelta

from fastapi import Depends, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import Session as DbSession, User, ensure_utc, utcnow
from app.services.security import hash_token

WRITE_METHODS = {"POST", "PATCH", "DELETE", "PUT"}
# 滑动续期：剩余有效期低于该阈值时刷新 expires_at，避免每个请求都写库
RENEW_THRESHOLD = timedelta(days=15)


def check_origin(request: Request) -> None:
    """写请求校验 Origin 白名单；无 Origin 头（非浏览器）放行。"""
    if request.method not in WRITE_METHODS:
        return
    origin = request.headers.get("origin")
    if not origin:
        return
    if origin.rstrip("/") not in get_settings().allowed_origins_list:
        raise ApiError("admin_required", "Origin 不在白名单内", 403)


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        return None
    now = utcnow()
    session = await db.scalar(select(DbSession).where(DbSession.token_hash == hash_token(token)))
    if session is None or (ensure_utc(session.expires_at) or now) <= now:
        return None
    user = await db.get(User, session.user_id)
    if user is None or user.status != "active":
        return None
    # 30 天滑动续期：剩余不足阈值时延长，避免每个请求都写库
    if ensure_utc(session.expires_at) - now < RENEW_THRESHOLD:
        await db.execute(
            update(DbSession)
            .where(DbSession.id == session.id)
            .values(expires_at=now + timedelta(days=get_settings().session_ttl_days))
        )
        await db.commit()
    return user


async def require_user(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise ApiError("auth_required", "请先登录", 401)
    return user


async def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise ApiError("admin_required", "需要管理员权限", 403)
    return user
