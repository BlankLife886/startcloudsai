"""认证：注册 / 登录 / 退出 / 当前用户。"""
from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.errors import ApiError, ok
from app.models import Session as DbSession, User, Wallet, utcnow
from app.schemas import LoginIn, RegisterIn
from app.serializers import user_dict
from app.services import settings_service, wallet as wallet_service
from app.services.security import hash_password, hash_token, new_session_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.app_env == "production",
        path="/",
    )


async def _create_session(db: AsyncSession, request: Request, user: User) -> str:
    token = new_session_token()
    db.add(
        DbSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=utcnow() + timedelta(days=get_settings().session_ttl_days),
            ip=request.client.host if request.client else None,
            user_agent=(request.headers.get("user-agent") or "")[:500] or None,
        )
    )
    return token


@router.post("/register")
async def register(body: RegisterIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    if not await settings_service.get_setting(db, "registration_enabled"):
        raise ApiError("validation_error", "当前未开放注册", 403)
    email = body.email.lower()
    existing = await db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise ApiError("email_exists", "该邮箱已注册", 409)

    user = User(
        email=email,
        username=(body.username or email.split("@")[0]).strip(),
        password_hash=hash_password(body.password),
        last_login_at=utcnow(),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ApiError("email_exists", "该邮箱已注册", 409)

    db.add(Wallet(user_id=user.id))
    await db.flush()
    bonus = int(await settings_service.get_setting(db, "signup_bonus_cents") or 0)
    if bonus > 0:
        await wallet_service.grant(
            db, user.id, bonus, source_type="signup_bonus", source_id=str(user.id), reason="注册赠送"
        )
    token = await _create_session(db, request, user)
    await db.commit()
    _set_session_cookie(response, token)
    return ok({"user": user_dict(user)})


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not verify_password(body.password, user.password_hash):
        raise ApiError("invalid_credentials", "邮箱或密码错误", 401)
    if user.status != "active":
        raise ApiError("invalid_credentials", "账号已被禁用", 403)
    user.last_login_at = utcnow()
    token = await _create_session(db, request, user)
    await db.commit()
    _set_session_cookie(response, token)
    return ok({"user": user_dict(user)})


@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get(get_settings().session_cookie_name)
    if token:
        await db.execute(delete(DbSession).where(DbSession.token_hash == hash_token(token)))
        await db.commit()
    response.delete_cookie(get_settings().session_cookie_name, path="/")
    return ok({})


@router.get("/me")
async def me(user: User | None = Depends(get_current_user)):
    return ok({"user": user_dict(user) if user else None})
