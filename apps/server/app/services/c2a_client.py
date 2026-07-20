"""chatgpt2api 客户端（OpenAI Images 兼容，b64_json）。"""
import httpx

from app.config import get_settings


class C2AUpstreamError(Exception):
    """上游返回的业务错误（不重试）。"""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class C2ANetworkError(Exception):
    """连接/超时类错误（可重试一次）。"""


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {get_settings().c2a_api_key}"}


def _extract_b64_list(payload: dict) -> list[str]:
    data = payload.get("data") or []
    images = [item.get("b64_json") for item in data if isinstance(item, dict) and item.get("b64_json")]
    if not images:
        raise C2AUpstreamError("上游未返回图片数据")
    return images


def _error_message(response: httpx.Response) -> str:
    try:
        body = response.json()
        detail = body.get("detail") or body.get("error") or body
        if isinstance(detail, dict):
            detail = detail.get("error") or detail.get("message") or str(detail)
        return str(detail)[:2000]
    except Exception:
        return response.text[:2000]


async def _post_json(path: str, payload: dict) -> dict:
    settings = get_settings()
    url = settings.c2a_base_url.rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=settings.c2a_timeout_secs) as client:
            response = await client.post(url, json=payload, headers=_headers())
    except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
        raise C2ANetworkError(f"上游连接失败：{exc}") from exc
    if response.status_code >= 400:
        raise C2AUpstreamError(_error_message(response), response.status_code)
    return response.json()


async def generate_images(
    prompt: str, model: str, n: int, size: str | None = None
) -> list[str]:
    """文生图 /v1/images/generations → base64 列表。"""
    payload: dict = {"model": model, "prompt": prompt, "n": n, "response_format": "b64_json"}
    if size:
        payload["size"] = size
    return _extract_b64_list(await _post_json("/v1/images/generations", payload))


async def edit_images(
    prompt: str, model: str, n: int, input_images_b64: list[str], size: str | None = None
) -> list[str]:
    """图生图 /v1/images/edits（JSON base64 引用）→ base64 列表。"""
    payload: dict = {
        "model": model,
        "prompt": prompt,
        "n": n,
        "response_format": "b64_json",
        "images": [{"b64_json": b64} for b64 in input_images_b64],
    }
    if size:
        payload["size"] = size
    return _extract_b64_list(await _post_json("/v1/images/edits", payload))


async def list_models() -> dict:
    """连通性测试 GET /v1/models。"""
    settings = get_settings()
    url = settings.c2a_base_url.rstrip("/") + "/v1/models"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url, headers=_headers())
    except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
        raise C2ANetworkError(f"上游连接失败：{exc}") from exc
    if response.status_code >= 400:
        raise C2AUpstreamError(_error_message(response), response.status_code)
    return response.json()
