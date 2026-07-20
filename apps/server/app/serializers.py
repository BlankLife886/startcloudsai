"""ORM → 对外 camelCase dict。时间统一 UTC ISO8601。"""
from datetime import datetime, timezone, date
from typing import Any

from app.models import (
    Announcement,
    ChangelogEntry,
    GallerySubmission,
    Notification,
    Order,
    Plan,
    Task,
    User,
    WalletLedger,
)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def user_dict(u: User) -> dict[str, Any]:
    return {
        "id": str(u.id),
        "email": u.email,
        "username": u.username,
        "avatarUrl": u.avatar_url,
        "role": u.role,
        "createdAt": iso(u.created_at),
    }


def admin_user_dict(u: User, wallet=None) -> dict[str, Any]:
    d = user_dict(u)
    d["status"] = u.status
    d["lastLoginAt"] = iso(u.last_login_at)
    if wallet is not None:
        d["wallet"] = {"balanceCents": wallet.balance_cents, "frozenCents": wallet.frozen_cents}
    return d


def task_dict(t: Task, output_urls: list[str] | None = None) -> dict[str, Any]:
    return {
        "id": str(t.id),
        "type": t.type,
        "status": t.status,
        "prompt": t.prompt,
        "params": t.params or {},
        "count": t.count,
        "inputKeys": t.input_keys or [],
        "outputKeys": t.output_keys or [],
        "outputUrls": output_urls if output_urls is not None else [],
        "costCents": t.cost_cents,
        "errorCode": t.error_code,
        "errorMessage": t.error_message,
        "createdAt": iso(t.created_at),
        "startedAt": iso(t.started_at),
        "finishedAt": iso(t.finished_at),
    }


def admin_task_dict(t: Task, user: User | None = None) -> dict[str, Any]:
    d = task_dict(t)
    d["userId"] = str(t.user_id)
    d["attempt"] = t.attempt
    if user is not None:
        d["user"] = {"id": str(user.id), "email": user.email, "username": user.username}
    return d


def ledger_dict(entry: WalletLedger) -> dict[str, Any]:
    return {
        "id": str(entry.id),
        "kind": entry.kind,
        "deltaCents": entry.delta_cents,
        "balanceAfterCents": entry.balance_after_cents,
        "sourceType": entry.source_type,
        "sourceId": entry.source_id,
        "reason": entry.reason,
        "createdAt": iso(entry.created_at),
    }


def plan_dict(p: Plan, include_admin: bool = False) -> dict[str, Any]:
    d = {
        "id": str(p.id),
        "code": p.code,
        "name": p.name,
        "priceCents": p.price_cents,
        "grantCents": p.grant_cents,
        "bonusCents": p.bonus_cents,
        "features": p.features or [],
        "sort": p.sort,
    }
    if include_admin:
        d["active"] = p.active
        d["createdAt"] = iso(p.created_at)
    return d


def order_dict(o: Order, pay_url: str | None = None) -> dict[str, Any]:
    return {
        "id": str(o.id),
        "planId": str(o.plan_id),
        "status": o.status,
        "amountCents": o.amount_cents,
        "grantCents": o.grant_cents,
        "bonusCents": o.bonus_cents,
        "provider": o.provider,
        "payUrl": pay_url,
        "paidAt": iso(o.paid_at),
        "completedAt": iso(o.completed_at),
        "createdAt": iso(o.created_at),
    }


def admin_order_dict(o: Order, user: User | None = None) -> dict[str, Any]:
    d = order_dict(o)
    d["userId"] = str(o.user_id)
    d["providerOrderId"] = o.provider_order_id
    if user is not None:
        d["user"] = {"id": str(user.id), "email": user.email, "username": user.username}
    return d


def notification_dict(n: Notification, read_at: datetime | None = None) -> dict[str, Any]:
    return {
        "id": str(n.id),
        "kind": n.kind,
        "title": n.title,
        "body": n.body,
        "readAt": iso(read_at if n.user_id is None else n.read_at),
        "createdAt": iso(n.created_at),
    }


def submission_dict(s: GallerySubmission, media_urls: list[str] | None = None) -> dict[str, Any]:
    return {
        "id": str(s.id),
        "taskId": str(s.task_id),
        "title": s.title,
        "status": s.status,
        "coverKey": s.cover_key,
        "mediaKeys": s.media_keys or [],
        "mediaUrls": media_urls or [],
        "rejectReason": s.reject_reason,
        "reviewedAt": iso(s.reviewed_at),
        "createdAt": iso(s.created_at),
    }


def announcement_dict(a: Announcement) -> dict[str, Any]:
    return {
        "id": str(a.id),
        "title": a.title,
        "body": a.body,
        "active": a.active,
        "startsAt": iso(a.starts_at),
        "endsAt": iso(a.ends_at),
        "createdAt": iso(a.created_at),
    }


def changelog_dict(c: ChangelogEntry) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "version": c.version,
        "date": c.date.isoformat() if isinstance(c.date, date) else c.date,
        "tag": c.tag,
        "title": c.title,
        "summary": c.summary,
        "items": c.items or [],
        "highlight": c.highlight,
        "sort": c.sort,
    }
