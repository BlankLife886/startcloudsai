"""统一错误模型：业务错误抛 ApiError，全局 handler 输出契约格式。"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app")


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def error_response(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "code": code, "error": message})


def ok(data=None) -> dict:
    return {"success": True, "data": data}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError):
        return error_response(exc.code, exc.message, exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        msg = first.get("msg", "参数校验失败")
        detail = f"{loc}: {msg}" if loc else msg
        return error_response("validation_error", detail, 422)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        code = {401: "auth_required", 403: "admin_required", 404: "not_found", 429: "rate_limited"}.get(
            exc.status_code, "internal_error" if exc.status_code >= 500 else "bad_request"
        )
        return error_response(code, str(exc.detail), exc.status_code)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        return error_response("internal_error", "服务器内部错误", 500)
