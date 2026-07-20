"""R2（S3 兼容）存储：上传 / 删除 / presigned GET。

boto3 为同步客户端，调用量小（单任务几次），在异步上下文经
run_in_threadpool 使用；presign 是纯本地签名计算，可直接调用。
"""
from functools import lru_cache

import boto3
from botocore.config import Config as BotoConfig
from starlette.concurrency import run_in_threadpool

from app.config import get_settings


@lru_cache
def _client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=BotoConfig(signature_version="s3v4", retries={"max_attempts": 2}),
    )


def upload_bytes_sync(key: str, data: bytes, content_type: str) -> None:
    _client().put_object(
        Bucket=get_settings().r2_bucket, Key=key, Body=data, ContentType=content_type
    )


async def upload_bytes(key: str, data: bytes, content_type: str) -> None:
    await run_in_threadpool(upload_bytes_sync, key, data, content_type)


def delete_keys_sync(keys: list[str]) -> None:
    if not keys:
        return
    bucket = get_settings().r2_bucket
    for i in range(0, len(keys), 1000):
        chunk = keys[i : i + 1000]
        _client().delete_objects(
            Bucket=bucket, Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True}
        )


async def delete_keys(keys: list[str]) -> None:
    await run_in_threadpool(delete_keys_sync, keys)


def get_bytes_sync(key: str) -> bytes:
    obj = _client().get_object(Bucket=get_settings().r2_bucket, Key=key)
    return obj["Body"].read()


async def get_bytes(key: str) -> bytes:
    return await run_in_threadpool(get_bytes_sync, key)


def presign_get(key: str, expires_in: int | None = None) -> str:
    settings = get_settings()
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket, "Key": key},
        ExpiresIn=expires_in or settings.r2_presign_expire_secs,
    )
