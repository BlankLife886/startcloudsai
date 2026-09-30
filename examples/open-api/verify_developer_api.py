#!/usr/bin/env python3
"""对真实部署的API 调用做一轮修复验收。

只用 Python 标准库，不需要安装依赖。分两级执行：

  免费检查（默认）：不会生成图片或调用对话，不消耗积分。
  付费检查（--paid）：真实生成 1 张图片、调用 2~3 次对话，会按站内价格扣积分。
      执行前会列出将要发起的付费请求并要求输入 yes 确认。

可选 --database-url：本地或测试库时，直接读取该 Key 所属账号的钱包冻结额，
用来确认“客户端中途断开后积分没有被冻结”。需要本机有 psql 命令。

用法：
  export STAR_CLOUD_BASE_URL='http://127.0.0.1:8000/v1'
  export STAR_CLOUD_API_KEY='sk-sc-...'        # 建议专门建一个小额度测试 Key
  python3 examples/open-api/verify_developer_api.py
  python3 examples/open-api/verify_developer_api.py --paid --image-model 模型名 --chat-model 模型名
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

TIMEOUT = 280


@dataclass
class Result:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Report:
    results: list[Result] = field(default_factory=list)

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.results.append(Result(name, ok, detail))
        mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
        print(f"  [{mark}] {name}" + (f"\n         {detail}" if detail else ""))
        return ok

    def skip(self, name: str, reason: str) -> None:
        print(f"  [\033[33mSKIP\033[0m] {name}\n         {reason}")


class Client:
    def __init__(self, base_url: str, api_key: str):
        parts = urlsplit(base_url.rstrip("/"))
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise SystemExit("STAR_CLOUD_BASE_URL 必须形如 https://域名/v1")
        self.scheme, self.netloc, self.prefix = parts.scheme, parts.netloc, parts.path
        self.api_key = api_key

    def connection(self, timeout: float = TIMEOUT) -> http.client.HTTPConnection:
        if self.scheme == "https":
            return http.client.HTTPSConnection(self.netloc, timeout=timeout, context=ssl.create_default_context())
        return http.client.HTTPConnection(self.netloc, timeout=timeout)

    def headers(self, extra: dict | None = None, key: str | None = None) -> dict:
        headers = {"Authorization": f"Bearer {key if key is not None else self.api_key}"}
        headers.update(extra or {})
        return headers

    def request(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None,
                key: str | None = None) -> tuple[int, dict, bytes]:
        connection = self.connection()
        try:
            connection.request(method, self.prefix + path, body=body, headers=self.headers(headers, key))
            response = connection.getresponse()
            return response.status, {k.lower(): v for k, v in response.getheaders()}, response.read()
        finally:
            connection.close()

    def json(self, method: str, path: str, payload: dict | None = None,
             key: str | None = None) -> tuple[int, dict, dict]:
        headers = {"Content-Type": "application/json"}
        body = json.dumps(payload).encode() if payload is not None else None
        status, response_headers, raw = self.request(method, path, body, headers, key)
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            data = {"_raw": raw[:300].decode("utf-8", "replace")}
        return status, response_headers, data


def error_code(data: dict) -> str:
    return str((data.get("error") or {}).get("code") or "")


def short(data: dict) -> str:
    text = json.dumps(data, ensure_ascii=False)
    return text if len(text) < 300 else text[:300] + "..."


# ---------------------------------------------------------------- free checks

def free_checks(client: Client, report: Report) -> dict:
    print("\n== 免费检查（不生成、不扣费）==")
    status, _, data = client.json("GET", "/models")
    models = [item.get("id") for item in data.get("data", [])] if status == 200 else []
    report.check("GET /v1/models 返回 200", status == 200, f"status={status} models={models}")

    status, _, data = client.json("GET", "/models", key="sk-sc-this-key-does-not-exist")
    report.check("无效 Key 返回 401 invalid_api_key", status == 401 and error_code(data) == "invalid_api_key",
                 f"status={status} body={short(data)}")

    # A 3 MiB chat body for a model that does not exist: the server must accept
    # the size and then reject the unknown model before any billing.
    padding = base64.b64encode(os.urandom(3 * 1024 * 1024)).decode()
    payload = {"model": "verify-no-such-model",
               "messages": [{"role": "user", "content": [{"type": "text", "text": "size probe"},
                                                        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + padding}}]}]}
    status, _, data = client.json("POST", "/chat/completions", payload)
    report.check("/v1/chat/completions 接受 >1 MiB 的请求体，未知模型返回 404",
                 status == 404 and error_code(data) == "model_not_found" and "verify-no-such-model" in str(data),
                 f"status={status} body={short(data)}")

    status, _, data = client.json("POST", "/images/generations", {"model": "x", "prompt": "p", "n": 0})
    report.check("非法参数在计费前被拒绝（400）", status == 400, f"status={status} body={short(data)}")
    return {"models": models}


# ---------------------------------------------------------------- paid checks

def paid_checks(client: Client, report: Report, args: argparse.Namespace) -> None:
    prompt = "a small red cube on a white table, minimal studio photo"
    print("\n== 付费检查 ==")

    if args.image_model:
        body = {"model": args.image_model, "prompt": prompt, "n": 1, "size": "auto", "quality": args.quality}
        before = read_usage(args)
        started = time.monotonic()
        status, headers, data = client.json("POST", "/images/generations", body)
        ok = status == 200 and bool((data.get("data") or [{}])[0].get("b64_json") or (data.get("data") or [{}])[0].get("url"))
        report.check("生成 1 张图片成功（扣费 1 次）", ok, f"status={status} 用时={time.monotonic() - started:.1f}s request_id={headers.get('x-request-id')}"
                     + ("" if ok else f" body={short(data)}"))
        report.check("付费接口提示 SDK 不要自动重试", headers.get("x-should-retry") == "false", f"X-Should-Retry={headers.get('x-should-retry')!r}")
        after = read_usage(args)
        if ok and before and after:
            report.check("这次请求计入 Key 用量 1 次",
                         after["todayTasks"] == before["todayTasks"] + 1 and after["todaySpendCents"] > before["todaySpendCents"],
                         f"之前={before} 之后={after}")
    else:
        report.skip("图片相关付费检查", "未提供 --image-model")

    if args.chat_model:
        before = read_usage(args)
        status, _, data = client.json("POST", "/chat/completions", {"model": args.chat_model, "messages": [
            {"role": "system", "content": "用中文，最多两个字。"}, {"role": "user", "content": "只回复两个字：你好"}]})
        content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
        report.check("对话成功，返回的 model 是你填的模型名", status == 200 and bool(content) and data.get("model") == args.chat_model,
                     f"status={status} model={data.get('model')!r} content={content!r}" + ("" if status == 200 else f" body={short(data)}"))
        after = read_usage(args)
        if before and after:
            report.check("对话计入 Key 日调用数和积分（修复前完全绕过额度）",
                         after["todayTasks"] == before["todayTasks"] + 1 and after["todaySpendCents"] > before["todaySpendCents"],
                         f"之前={before} 之后={after}")

        wallet_before = read_wallet(args)
        disconnected = stream_and_disconnect(client, args.chat_model)
        report.check("流式对话收到部分回答后客户端主动断开", disconnected, "")
        time.sleep(3)
        after_abort = read_usage(args)
        if after and after_abort:
            report.check("已收到回答后断开的对话照常扣费，计入 Key 用量",
                         after_abort["todayTasks"] == after["todayTasks"] + 1, f"断开前={after} 断开后={after_abort}")
        wallet_after = read_wallet(args)
        if wallet_before and wallet_after:
            report.check("中途断开后钱包冻结额没有增加（修复前会永久冻结）",
                         wallet_after[1] <= wallet_before[1], f"断开前 余额/冻结={wallet_before} 断开后={wallet_after}")
        elif args.database_url:
            report.skip("钱包冻结额检查", "无法通过 psql 读取钱包")
    else:
        report.skip("对话相关付费检查", "未提供 --chat-model")


def stream_and_disconnect(client: Client, model: str) -> bool:
    # A long answer makes it very likely the stream is still running when we cut it.
    body = json.dumps({"model": model, "stream": True,
                       "messages": [{"role": "user", "content": "请写一篇 1500 字的散文，主题是秋天的城市。"}]}).encode()
    connection = client.connection(timeout=120)
    try:
        connection.request("POST", client.prefix + "/chat/completions", body=body,
                           headers=client.headers({"Content-Type": "application/json"}))
        response = connection.getresponse()
        if response.status != 200:
            print(f"         流式请求失败 status={response.status} body={response.read()[:300]!r}")
            return False
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            line = response.fp.readline()
            if not line:
                return False
            if b'"content":"' in line and b'"content":""' not in line:
                break
        # Close the socket abruptly, like a user closing their client.
        try:
            connection.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        return True
    finally:
        connection.close()


def read_usage(args: argparse.Namespace) -> dict | None:
    """Today's Key usage (UTC day), the same numbers the console shows. Needs --database-url."""
    if not args.database_url or not shutil.which("psql"):
        return None
    key_hash = hashlib.sha256(os.environ["STAR_CLOUD_API_KEY"].strip().encode()).hexdigest()
    query = ("SELECT count(e.*), COALESCE(SUM(e.reserved_cents), 0) FROM user_api_keys k "
             "LEFT JOIN api_key_usage_events e ON e.api_key_id = k.id "
             "AND e.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' "
             f"WHERE k.key_hash = '{key_hash}' GROUP BY k.id")
    result = subprocess.run(["psql", args.database_url, "-At", "-F", ",", "-c", query], capture_output=True, text=True, timeout=30)
    if result.returncode != 0 or not result.stdout.strip():
        print(f"         psql 读取用量失败: {result.stderr.strip()[:200]}")
        return None
    tasks, spend = result.stdout.strip().split(",")
    return {"todayTasks": int(tasks), "todaySpendCents": int(spend)}


def read_wallet(args: argparse.Namespace) -> tuple[int, int] | None:
    if not args.database_url:
        return None
    if not shutil.which("psql"):
        print("         未找到 psql，跳过钱包检查")
        return None
    # The server stores sha256(secret); matching on it never sends the secret to psql.
    key_hash = hashlib.sha256(os.environ["STAR_CLOUD_API_KEY"].strip().encode()).hexdigest()
    query = ("SELECT w.balance_cents, w.frozen_cents FROM wallets w JOIN user_api_keys k ON k.user_id = w.user_id "
             f"WHERE k.key_hash = '{key_hash}' LIMIT 1")
    result = subprocess.run(["psql", args.database_url, "-At", "-F", ",", "-c", query], capture_output=True, text=True, timeout=30)
    if result.returncode != 0 or not result.stdout.strip():
        print(f"         psql 读取失败: {result.stderr.strip()[:200]}")
        return None
    balance, frozen = result.stdout.strip().split(",")
    return int(balance), int(frozen)


def main() -> int:
    parser = argparse.ArgumentParser(description="API 调用修复验收（真实环境）")
    parser.add_argument("--paid", action="store_true", help="执行会扣积分的检查")
    parser.add_argument("--image-model", help="GET /v1/models 返回的图片模型 ID")
    parser.add_argument("--chat-model", help="GET /v1/models 返回的对话模型 ID")
    parser.add_argument("--quality", default="auto", help="生图质量，默认 auto；模型支持时可用 low 降低成本")
    parser.add_argument("--database-url", help="可选：Postgres 连接串，用于读取 Key 用量和钱包冻结额")
    parser.add_argument("--yes", action="store_true", help="跳过付费确认（仅在你已确认成本时使用）")
    args = parser.parse_args()

    base_url = os.environ.get("STAR_CLOUD_BASE_URL", "").strip()
    api_key = os.environ.get("STAR_CLOUD_API_KEY", "").strip()
    if not base_url or not api_key:
        print("请先设置 STAR_CLOUD_BASE_URL 和 STAR_CLOUD_API_KEY", file=sys.stderr)
        return 2
    client = Client(base_url, api_key)
    report = Report()
    free_checks(client, report)

    if args.paid:
        planned = []
        if args.image_model:
            planned.append(f"生成 1 张图片（模型 {args.image_model}，质量 {args.quality}），另有 2 次同键重投由上游再次出图但不向你扣费")
        if args.chat_model:
            planned.append(f"2 次对话（模型 {args.chat_model}），其中 1 次在收到部分回答后断开，照常扣费")
        if not planned:
            print("\n--paid 需要至少提供 --image-model 或 --chat-model")
        else:
            print("\n即将发起以下付费请求：\n  - " + "\n  - ".join(planned))
            if args.yes or input("确认执行？输入 yes 继续: ").strip().lower() == "yes":
                paid_checks(client, report, args)
            else:
                print("已取消付费检查。")

    failed = [item for item in report.results if not item.ok]
    print(f"\n结果：{len(report.results) - len(failed)} 通过，{len(failed)} 失败")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
