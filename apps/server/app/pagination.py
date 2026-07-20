"""cursor 分页：cursor = base64("<created_at_iso>|<id>")，按 (created_at, id) 倒序。"""
import base64
import binascii
import uuid
from datetime import datetime

from sqlalchemy import Select, and_, or_, tuple_

from app.errors import ApiError


def encode_cursor(created_at: datetime, item_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}|{item_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        ts, item_id = raw.split("|", 1)
        return datetime.fromisoformat(ts), uuid.UUID(item_id)
    except (ValueError, binascii.Error) as exc:
        raise ApiError("validation_error", "无效的 cursor", 422) from exc


def apply_cursor(stmt: Select, model, cursor: str | None, limit: int) -> Select:
    """追加倒序排序、cursor 条件与 limit+1（多取一条判断 nextCursor）。"""
    if cursor:
        created_at, item_id = decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                model.created_at < created_at,
                and_(model.created_at == created_at, model.id < item_id),
            )
        )
    return stmt.order_by(model.created_at.desc(), model.id.desc()).limit(limit + 1)


def build_page(rows: list, limit: int, serialize, id_attr: str = "id") -> dict:
    """rows 为 limit+1 条查询结果；serialize(row) → dict。"""
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(last.created_at, getattr(last, id_attr))
    return {"items": [serialize(r) for r in rows], "nextCursor": next_cursor}
