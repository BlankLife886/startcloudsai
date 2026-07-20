"""arq Worker 配置（arq app.worker.WorkerSettings 启动）。"""
from arq import cron

from app.config import get_settings
from app.services.queue import redis_settings
from app.services.task_runner import cleanup_expired_sessions, reap_zombie_tasks, run_task


class WorkerSettings:
    functions = [run_task]
    cron_jobs = [
        cron(cleanup_expired_sessions, minute=0, unique=True),
        cron(reap_zombie_tasks, minute={0, 10, 20, 30, 40, 50}, unique=True),
    ]
    redis_settings = redis_settings()
    max_jobs = get_settings().worker_concurrency
    # 生成图片耗时较长：任务超时给足余量（上游超时 + 重试 + 上传）
    job_timeout = get_settings().c2a_timeout_secs * 2 + 120
    keep_result = 300
