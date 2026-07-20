"""上传：≤15MB，png/jpg/webp 魔数校验，写 R2 uploads/{user_id}/{uuid}.{ext}。"""
import uuid

from fastapi import APIRouter, Depends, UploadFile
from app.config import get_settings
from app.deps import require_user
from app.errors import ApiError, ok
from app.models import User
from app.services import storage

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


def sniff_image(data: bytes) -> tuple[str, str] | None:
    """魔数识别 → (ext, content_type)；不支持返回 None。"""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


@router.post("")
async def upload(file: UploadFile, user: User = Depends(require_user)):
    max_bytes = get_settings().upload_max_bytes
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ApiError("upload_too_large", "文件不能超过 15MB", 413)
    if not data:
        raise ApiError("unsupported_file", "文件为空", 400)
    sniffed = sniff_image(data)
    if sniffed is None:
        raise ApiError("unsupported_file", "仅支持 png / jpg / webp 图片", 400)
    ext, content_type = sniffed
    key = f"uploads/{user.id}/{uuid.uuid4()}.{ext}"
    await storage.upload_bytes(key, data, content_type)
    return ok({"key": key, "url": f"/api/files/{key}"})
