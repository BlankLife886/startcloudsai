"""后台管理接口（全部要求 role=admin）。"""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_admin
from app.errors import ApiError, ok
from app.models import (
    Announcement,
    ChangelogEntry,
    GallerySubmission,
    Notification,
    Order,
    ORDER_STATUSES,
    Plan,
    Task,
    TASK_STATUSES,
    TASK_TYPES,
    User,
    Wallet,
    utcnow,
)
from app.pagination import apply_cursor, build_page
from app.schemas import (
    AdminUserPatch,
    AnnouncementIn,
    AnnouncementPatch,
    ChangelogIn,
    ChangelogPatch,
    GalleryReviewIn,
    PlanIn,
    PlanPatch,
    SettingsPut,
    WalletAdjustIn,
)
from app.serializers import (
    admin_order_dict,
    admin_task_dict,
    admin_user_dict,
    announcement_dict,
    changelog_dict,
    ledger_dict,
    plan_dict,
    submission_dict,
)
from app.services import c2a_client, settings_service, task_service, wallet as wallet_service
from app.services.queue import enqueue_task

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------- stats ----------

@router.get("/stats")
async def stats(db: AsyncSession = Depends(get_db)):
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    total_users = await db.scalar(select(func.count()).select_from(User)) or 0
    new_users_today = (
        await db.scalar(select(func.count()).select_from(User).where(User.created_at >= today_start)) or 0
    )
    running_tasks = (
        await db.scalar(
            select(func.count()).select_from(Task).where(Task.status.in_(("queued", "running")))
        )
        or 0
    )

    daily_rows = (
        await db.execute(
            select(
                func.date(Task.created_at).label("day"),
                func.count(),
                func.count().filter(Task.status == "succeeded"),
            )
            .where(Task.created_at >= week_ago)
            .group_by("day")
        )
    ).all()
    by_day = {str(day): (total, succeeded) for day, total, succeeded in daily_rows}
    task_daily = []
    for offset in range(6, -1, -1):
        day = (now - timedelta(days=offset)).date().isoformat()
        total, succeeded = by_day.get(day, (0, 0))
        task_daily.append({"date": day, "total": total, "succeeded": succeeded})

    revenue = (
        await db.scalar(
            select(func.coalesce(func.sum(Order.amount_cents), 0)).where(
                Order.status == "completed", Order.created_at >= month_ago
            )
        )
        or 0
    )
    balance_total = await db.scalar(select(func.coalesce(func.sum(Wallet.balance_cents), 0))) or 0

    return ok(
        {
            "totalUsers": total_users,
            "newUsersToday": new_users_today,
            "runningTasks": running_tasks,
            "taskDaily": task_daily,
            "revenueCents": revenue,
            "walletBalanceCents": balance_total,
        }
    )


# ---------- users ----------

@router.get("/users")
async def list_users(
    search: str | None = None,
    status: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(User)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(or_(User.email.ilike(pattern), User.username.ilike(pattern)))
    if status:
        if status not in ("active", "banned"):
            raise ApiError("validation_error", "无效的用户状态", 422)
        stmt = stmt.where(User.status == status)
    rows = list((await db.scalars(apply_cursor(stmt, User, cursor, limit))).all())
    wallets = {}
    if rows:
        wallet_rows = (
            await db.scalars(select(Wallet).where(Wallet.user_id.in_([u.id for u in rows])))
        ).all()
        wallets = {w.user_id: w for w in wallet_rows}
    return ok(build_page(rows, limit, lambda u: admin_user_dict(u, wallets.get(u.id))))


@router.patch("/users/{user_id}")
async def patch_user(user_id: uuid.UUID, body: AdminUserPatch, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if user is None:
        raise ApiError("not_found", "用户不存在", 404)
    if body.status is not None:
        user.status = body.status
    if body.role is not None:
        user.role = body.role
    await db.commit()
    return ok(admin_user_dict(user))


@router.post("/users/{user_id}/wallet-adjust")
async def wallet_adjust(user_id: uuid.UUID, body: WalletAdjustIn, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if user is None:
        raise ApiError("not_found", "用户不存在", 404)
    if body.delta_cents == 0:
        raise ApiError("validation_error", "调整金额不能为 0", 422)
    entry = await wallet_service.admin_adjust(
        db, user_id, body.delta_cents, source_id=str(uuid.uuid4()), reason=body.reason
    )
    await db.commit()
    return ok(ledger_dict(entry))


# ---------- orders ----------

@router.get("/orders")
async def list_orders(
    status: str | None = None,
    search: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Order)
    if status:
        if status not in ORDER_STATUSES:
            raise ApiError("validation_error", "无效的订单状态", 422)
        stmt = stmt.where(Order.status == status)
    if search:
        matched = await _match_user_ids(db, search)
        stmt = stmt.where(Order.user_id.in_(matched or [uuid.UUID(int=0)]))
    rows = list((await db.scalars(apply_cursor(stmt, Order, cursor, limit))).all())
    users = {}
    plans = {}
    if rows:
        user_rows = (await db.scalars(select(User).where(User.id.in_({o.user_id for o in rows})))).all()
        users = {u.id: u for u in user_rows}
        plan_rows = (await db.scalars(select(Plan).where(Plan.id.in_({o.plan_id for o in rows})))).all()
        plans = {p.id: p for p in plan_rows}

    def serialize(o: Order) -> dict:
        d = admin_order_dict(o, users.get(o.user_id))
        user = users.get(o.user_id)
        plan = plans.get(o.plan_id)
        d["userEmail"] = user.email if user else None
        d["planName"] = plan.name if plan else None
        return d

    return ok(build_page(rows, limit, serialize))


async def _match_user_ids(db: AsyncSession, keyword: str) -> list[uuid.UUID]:
    """按 id/邮箱/用户名模糊匹配用户 id，用于订单与任务的 user 筛选。"""
    keyword = keyword.strip()
    try:
        return [uuid.UUID(keyword)]
    except ValueError:
        pass
    pattern = f"%{keyword}%"
    rows = (
        await db.scalars(
            select(User.id).where(or_(User.email.ilike(pattern), User.username.ilike(pattern))).limit(200)
        )
    ).all()
    return list(rows)


@router.post("/orders/{order_id}/complete")
async def complete_order_endpoint(order_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    from app.services.order_service import complete_order

    order = await db.get(Order, order_id)
    if order is None:
        raise ApiError("order_not_found", "订单不存在", 404)
    order = await complete_order(db, order)
    await db.commit()
    return ok(admin_order_dict(order))


# ---------- plans ----------

@router.get("/plans")
async def admin_list_plans(db: AsyncSession = Depends(get_db)):
    plans = (await db.scalars(select(Plan).order_by(Plan.sort, Plan.created_at))).all()
    return ok({"items": [plan_dict(p, include_admin=True) for p in plans]})


@router.post("/plans")
async def create_plan(body: PlanIn, db: AsyncSession = Depends(get_db)):
    existing = await db.scalar(select(Plan).where(Plan.code == body.code))
    if existing is not None:
        raise ApiError("validation_error", "套餐 code 已存在", 409)
    plan = Plan(**body.model_dump())
    db.add(plan)
    await db.commit()
    return ok(plan_dict(plan, include_admin=True))


@router.patch("/plans/{plan_id}")
async def patch_plan(plan_id: uuid.UUID, body: PlanPatch, db: AsyncSession = Depends(get_db)):
    plan = await db.get(Plan, plan_id)
    if plan is None:
        raise ApiError("plan_not_found", "套餐不存在", 404)
    updates = body.model_dump(exclude_unset=True)
    if "code" in updates and updates["code"] != plan.code:
        existing = await db.scalar(select(Plan).where(Plan.code == updates["code"]))
        if existing is not None:
            raise ApiError("validation_error", "套餐 code 已存在", 409)
    for field, value in updates.items():
        setattr(plan, field, value)
    await db.commit()
    return ok(plan_dict(plan, include_admin=True))


@router.delete("/plans/{plan_id}")
async def delete_plan(plan_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    plan = await db.get(Plan, plan_id)
    if plan is None:
        raise ApiError("plan_not_found", "套餐不存在", 404)
    # 有历史订单外键引用，下架而非物理删除
    plan.active = False
    await db.commit()
    return ok({})


# ---------- tasks ----------

@router.get("/tasks")
async def admin_list_tasks(
    type: str | None = None,
    status: str | None = None,
    user: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Task)
    if type:
        if type not in TASK_TYPES:
            raise ApiError("validation_error", "无效的任务类型", 422)
        stmt = stmt.where(Task.type == type)
    if status:
        if status not in TASK_STATUSES:
            raise ApiError("validation_error", "无效的任务状态", 422)
        stmt = stmt.where(Task.status == status)
    if user:
        matched = await _match_user_ids(db, user)
        stmt = stmt.where(Task.user_id.in_(matched or [uuid.UUID(int=0)]))
    rows = list((await db.scalars(apply_cursor(stmt, Task, cursor, limit))).all())
    users = {}
    if rows:
        user_rows = (await db.scalars(select(User).where(User.id.in_({t.user_id for t in rows})))).all()
        users = {u.id: u for u in user_rows}

    def serialize(t: Task) -> dict:
        d = admin_task_dict(t, users.get(t.user_id))
        u = users.get(t.user_id)
        d["userEmail"] = u.email if u else None
        return d

    return ok(build_page(rows, limit, serialize))


@router.post("/tasks/{task_id}/requeue")
async def requeue_task(task_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    task = await task_service.requeue_task(db, task_id)
    await db.commit()
    await enqueue_task(str(task.id))
    return ok(admin_task_dict(task))


# ---------- gallery ----------

@router.get("/gallery/submissions")
async def admin_submissions(
    status: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(GallerySubmission)
    if status:
        if status not in ("pending", "approved", "rejected", "removed"):
            raise ApiError("validation_error", "无效的投稿状态", 422)
        stmt = stmt.where(GallerySubmission.status == status)
    rows = list((await db.scalars(apply_cursor(stmt, GallerySubmission, cursor, limit))).all())
    users = {}
    if rows:
        user_rows = (await db.scalars(select(User).where(User.id.in_({s.user_id for s in rows})))).all()
        users = {u.id: u for u in user_rows}

    def serialize(s: GallerySubmission) -> dict:
        d = submission_dict(s)
        author = users.get(s.user_id)
        d["user"] = (
            {"id": str(author.id), "email": author.email, "username": author.username} if author else None
        )
        return d

    return ok(build_page(rows, limit, serialize))


@router.post("/gallery/submissions/{submission_id}/review")
async def review_submission(
    submission_id: uuid.UUID,
    body: GalleryReviewIn,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    submission = await db.get(GallerySubmission, submission_id)
    if submission is None:
        raise ApiError("not_found", "投稿不存在", 404)
    new_status = {"approve": "approved", "reject": "rejected", "remove": "removed"}[body.action]
    submission.status = new_status
    submission.reject_reason = body.reason if body.action in ("reject", "remove") else None
    submission.reviewed_by = admin.id
    submission.reviewed_at = utcnow()
    db.add(
        Notification(
            user_id=submission.user_id,
            kind="system",
            title="投稿审核结果",
            body=f"你的投稿「{submission.title or ''}」审核结果：{new_status}。"
            + (f" 原因：{body.reason}" if body.reason else ""),
        )
    )
    await db.commit()
    return ok(submission_dict(submission))


# ---------- announcements ----------

@router.get("/announcements")
async def admin_announcements(db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(Announcement).order_by(Announcement.created_at.desc()))).all()
    return ok({"items": [announcement_dict(a) for a in rows]})


@router.post("/announcements")
async def create_announcement(body: AnnouncementIn, db: AsyncSession = Depends(get_db)):
    announcement = Announcement(**body.model_dump())
    db.add(announcement)
    # 同步生成一条全站通知（user_id NULL），进入用户通知合并流
    db.add(Notification(user_id=None, kind="announcement", title=body.title, body=body.body))
    await db.commit()
    return ok(announcement_dict(announcement))


@router.patch("/announcements/{announcement_id}")
async def patch_announcement(
    announcement_id: uuid.UUID, body: AnnouncementPatch, db: AsyncSession = Depends(get_db)
):
    announcement = await db.get(Announcement, announcement_id)
    if announcement is None:
        raise ApiError("not_found", "公告不存在", 404)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(announcement, field, value)
    await db.commit()
    return ok(announcement_dict(announcement))


@router.delete("/announcements/{announcement_id}")
async def delete_announcement(announcement_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    announcement = await db.get(Announcement, announcement_id)
    if announcement is None:
        raise ApiError("not_found", "公告不存在", 404)
    await db.delete(announcement)
    await db.commit()
    return ok({})


# ---------- changelog ----------

@router.get("/changelog")
async def admin_changelog(db: AsyncSession = Depends(get_db)):
    rows = (
        await db.scalars(
            select(ChangelogEntry).order_by(
                ChangelogEntry.date.desc(), ChangelogEntry.sort.desc(), ChangelogEntry.created_at.desc()
            )
        )
    ).all()
    return ok({"items": [changelog_dict(c) for c in rows]})


@router.post("/changelog")
async def create_changelog(body: ChangelogIn, db: AsyncSession = Depends(get_db)):
    entry = ChangelogEntry(**body.model_dump())
    db.add(entry)
    await db.commit()
    return ok(changelog_dict(entry))


@router.patch("/changelog/{entry_id}")
async def patch_changelog(entry_id: uuid.UUID, body: ChangelogPatch, db: AsyncSession = Depends(get_db)):
    entry = await db.get(ChangelogEntry, entry_id)
    if entry is None:
        raise ApiError("not_found", "更新说明不存在", 404)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    await db.commit()
    return ok(changelog_dict(entry))


@router.delete("/changelog/{entry_id}")
async def delete_changelog(entry_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    entry = await db.get(ChangelogEntry, entry_id)
    if entry is None:
        raise ApiError("not_found", "更新说明不存在", 404)
    await db.delete(entry)
    await db.commit()
    return ok({})


# ---------- settings ----------

_SETTINGS_CAMEL = {
    "task_prices": "taskPrices",
    "user_max_running_tasks": "userMaxRunningTasks",
    "signup_bonus_cents": "signupBonusCents",
    "registration_enabled": "registrationEnabled",
    "task_models": "taskModels",
    "free_daily_cents": "freeDailyCents",
}


def _settings_to_camel(settings: dict) -> dict:
    return {_SETTINGS_CAMEL.get(k, k): v for k, v in settings.items()}


@router.get("/settings")
async def get_admin_settings(db: AsyncSession = Depends(get_db)):
    return ok(_settings_to_camel(await settings_service.get_all_settings(db)))


@router.put("/settings")
async def put_admin_settings(body: SettingsPut, db: AsyncSession = Depends(get_db)):
    updates = body.model_dump(exclude_unset=True, exclude_none=True)
    if "task_prices" in updates:
        invalid = set(updates["task_prices"]) - set(TASK_TYPES)
        if invalid:
            raise ApiError("validation_error", f"未知任务类型：{', '.join(sorted(invalid))}", 422)
        if any(int(v) < 0 for v in updates["task_prices"].values()):
            raise ApiError("validation_error", "任务单价不能为负", 422)
    for key, value in updates.items():
        await settings_service.set_setting(db, key, value)
    await db.commit()
    return ok(_settings_to_camel(await settings_service.get_all_settings(db)))


@router.post("/settings/test-c2a")
async def test_c2a():
    try:
        result = await c2a_client.list_models()
    except (c2a_client.C2ANetworkError, c2a_client.C2AUpstreamError) as exc:
        raise ApiError("c2a_test_failed", str(exc)[:500] or "chatgpt2api 连接失败", 502)
    models = [m.get("id") for m in result.get("data", []) if isinstance(m, dict)]
    return ok({"ok": True, "modelCount": len(models), "models": models[:20]})
