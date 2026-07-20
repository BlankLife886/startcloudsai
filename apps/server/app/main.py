"""FastAPI 入口。"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from app.config import get_settings
from app.errors import error_response, register_exception_handlers
from app.routers import admin, auth, files, gallery, me, meta, orders, plans, tasks, uploads
from app.services.queue import close_arq_pool

logging.basicConfig(level=logging.INFO)

WRITE_METHODS = {"POST", "PATCH", "DELETE", "PUT"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_arq_pool()


app = FastAPI(title="StarClouds AI", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

register_exception_handlers(app)


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    """写请求校验 Origin 白名单；无 Origin 头的非浏览器请求放行。"""
    if request.method in WRITE_METHODS:
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in get_settings().allowed_origins_list:
            return error_response("admin_required", "Origin 不在白名单内", 403)
    return await call_next(request)


for router in (
    auth.router,
    me.router,
    tasks.router,
    uploads.router,
    files.router,
    plans.router,
    orders.router,
    gallery.router,
    meta.router,
    admin.router,
):
    app.include_router(router)
