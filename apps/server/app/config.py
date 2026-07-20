"""环境变量配置（与仓库根 .env.example 对齐）。"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_secret: str = "dev-secret-change-me"
    allowed_origins: str = "http://localhost:8080"

    database_url: str = "postgresql+asyncpg://starclouds:starclouds@localhost:5432/starclouds"
    redis_url: str = "redis://localhost:6379/0"

    c2a_base_url: str = "http://localhost:3000"
    c2a_api_key: str = ""
    c2a_timeout_secs: int = 180

    r2_endpoint: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "starcloudsai"
    r2_presign_expire_secs: int = 3600

    worker_concurrency: int = 8
    user_max_running_tasks: int = 3

    session_cookie_name: str = "sc_session"
    session_ttl_days: int = 30
    upload_max_bytes: int = 15 * 1024 * 1024

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
