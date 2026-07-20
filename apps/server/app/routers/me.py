"""个人中心：资料 / 总览 / 钱包 / 账本 / 通知。"""
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_user
from app.errors import ApiError, ok
from app.models import (
    Notification,
    NotificationRead,
    Task,
    User,
    WalletLedger,
    utcnow,
)
from app.pagination import apply_cursor, build_page
from app.schemas import NotificationsReadIn, ProfilePatch
from app.serializers import ledger_dict, notification_dict, task_dict, user_dict
from app.services.security import hash_password, verify_password
from app.services.wallet import get_wallet

router = APIRouter(prefix="/api/me", tags=["me"])


@router.patch("/profile")
async def patch_profile(body: ProfilePatch, user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    if body.username is not None:
        user.username = body.username.strip()
    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url or None
    if body.password is not None:
        if not verify_password(body.password.old, user.password_hash):
            raise ApiError("invalid_credentials", "原密码错误", 400)
        user.password_hash = hash_password(body.password.new)
    await db.commit()
    return ok({"user": user_dict(user)})


def _visible_notifications_filter(user_id: uuid.UUID):
    return or_(Notification.user_id == user_id, Notification.user_id.is_(None))


async def _unread_count(db: AsyncSession, user_id: uuid.UUID) -> int:
    personal = await db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
    )
    global_unread = await db.scalar(
        select(func.count())
        .select_from(Notification)
        .outerjoin(
            NotificationRead,
            and_(
                NotificationRead.notification_id == Notification.id,
                NotificationRead.user_id == user_id,
            ),
        )
        .where(Notification.user_id.is_(None), NotificationRead.notification_id.is_(None))
    )
    return (personal or 0) + (global_unread or 0)


@router.get("/overview")
async def overview(user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    wallet = await get_wallet(db, user.id)

    status_rows = (
        await db.execute(
            select(Task.status, func.count()).where(Task.user_id == user.id).group_by(Task.status)
        )
    ).all()
    by_status = {status: count for status, count in status_rows}
    type_rows = (
        await db.execute(
            select(Task.type, func.count()).where(Task.user_id == user.id).group_by(Task.type)
        )
    ).all()

    recent = (
        await db.scalars(
            select(Task).where(Task.user_id == user.id).order_by(Task.created_at.desc(), Task.id.desc()).limit(5)
        )
    ).all()

    return ok(
        {
            "wallet": {"balanceCents": wallet.balance_cents, "frozenCents": wallet.frozen_cents},
            "taskStats": {
                "total": sum(by_status.values()),
                "succeeded": by_status.get("succeeded", 0),
                "failed": by_status.get("failed", 0),
                "running": by_status.get("running", 0) + by_status.get("queued", 0),
            },
            "taskStatsByType": {t: c for t, c in type_rows},
            "unreadNotifications": await _unread_count(db, user.id),
            "recentTasks": [task_dict(t) for t in recent],
        }
    )


@router.get("/wallet")
async def my_wallet(user: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    wallet = await get_wallet(db, user.id)
    return ok({"balanceCents": wallet.balance_cents, "frozenCents": wallet.frozen_cents})


@router.get("/wallet/ledger")
async def my_ledger(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = apply_cursor(select(WalletLedger).where(WalletLedger.user_id == user.id), WalletLedger, cursor, limit)
    rows = (await db.scalars(stmt)).all()
    return ok(build_page(list(rows), limit, ledger_dict))


@router.get("/notifications")
async def my_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = apply_cursor(
        select(Notification).where(_visible_notifications_filter(user.id)), Notification, cursor, limit
    )
    rows = list((await db.scalars(stmt)).all())

    global_ids = [n.id for n in rows if n.user_id is None]
    reads: dict[uuid.UUID, NotificationRead] = {}
    if global_ids:
        read_rows = (
            await db.scalars(
                select(NotificationRead).where(
                    NotificationRead.user_id == user.id,
                    NotificationRead.notification_id.in_(global_ids),
                )
            )
        ).all()
        reads = {r.notification_id: r for r in read_rows}

    def serialize(n: Notification) -> dict:
        read = reads.get(n.id)
        return notification_dict(n, read_at=read.created_at if read else None)

    page = build_page(rows, limit, serialize)
    page["unread"] = await _unread_count(db, user.id)
    return ok(page)


@router.post("/notifications/read")
async def mark_notifications_read(
    body: NotificationsReadIn, user: User = Depends(require_user), db: AsyncSession = Depends(get_db)
):
    now = utcnow()
    if body.ids:
        targets = (
            await db.scalars(
                select(Notification).where(
                    Notification.id.in_(body.ids), _visible_notifications_filter(user.id)
                )
            )
        ).all()
    else:
        targets = (
            await db.scalars(select(Notification).where(_visible_notifications_filter(user.id)))
        ).all()

    global_ids = [n.id for n in targets if n.user_id is None]
    existing_reads: set[uuid.UUID] = set()
    if global_ids:
        existing_reads = set(
            (
                await db.scalars(
                    select(NotificationRead.notification_id).where(
                        NotificationRead.user_id == user.id,
                        NotificationRead.notification_id.in_(global_ids),
                    )
                )
            ).all()
        )

    personal_ids = [n.id for n in targets if n.user_id == user.id]
    if personal_ids:
        await db.execute(
            update(Notification)
            .where(Notification.id.in_(personal_ids), Notification.read_at.is_(None))
            .values(read_at=now)
        )
    for nid in global_ids:
        if nid not in existing_reads:
            db.add(NotificationRead(user_id=user.id, notification_id=nid))
    await db.commit()
    return ok({})
