"""OpenAI Images compatibility example. Only generate/edit commands create paid tasks."""

import argparse
import base64
import os
from contextlib import ExitStack
from pathlib import Path
from urllib.parse import urlparse


def image_extension(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    raise ValueError("返回的图片格式无法识别；请保留任务 ID，从任务接口检查结果")


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("models", help="只读取可用模型，不创建图片任务")
    for name in ("generate", "edit"):
        command = commands.add_parser(name, help="创建一张图片，会按站内价格消耗积分")
        command.add_argument("--model", required=True, help="模型目录返回的真实 ID")
        command.add_argument("--prompt", required=True)
        command.add_argument("--idempotency-key", required=True, help="提前保存的请求唯一编号；同一请求重试时复用")
        command.add_argument("--output", type=Path, default=Path("result.png"))
        if name == "edit":
            command.add_argument("--image", type=Path, action="append", required=True, help="本地图片；多图重复此选项")
    return parser, parser.parse_args()


def main():
    parser, args = arguments()
    api_key = os.environ.get("STAR_CLOUD_API_KEY", "").strip()
    base_url = os.environ.get("STAR_CLOUD_BASE_URL", "").rstrip("/")
    if not api_key or not base_url:
        parser.error("请设置 STAR_CLOUD_API_KEY 和 STAR_CLOUD_BASE_URL（以 /v1 结尾）")
    location = urlparse(base_url)
    if location.path != "/v1" or not location.hostname or location.username or location.password or location.query or location.fragment:
        parser.error("Base URL 应为 https://你的域名/v1，不能使用 /api/open/v1")
    if location.scheme != "https" and not (location.scheme == "http" and location.hostname in ("localhost", "127.0.0.1", "::1")):
        parser.error("远程调用必须使用 HTTPS，本机测试可用 HTTP")
    if api_key.startswith("demo_"):
        parser.error("演示 Key 不能调用真实 API；请在真实控制台创建测试 Key")

    if args.command != "models":
        if not args.prompt.strip() or not args.idempotency_key.strip():
            parser.error("提示词与幂等键不能为空")
        if not args.output.parent.is_dir():
            parser.error("输出目录不存在，请先创建目录")
        # Check all supported extensions before making a paid request. Never overwrite.
        if any(path.exists() for path in {args.output, *(args.output.with_suffix(ext) for ext in (".png", ".jpg", ".webp"))}):
            parser.error("输出图片已存在，请选择新的输出名称；重复下载仍须复用原幂等键")
        if args.command == "edit":
            if len(args.image) > 6 or any(not path.is_file() for path in args.image):
                parser.error("需要 1 至 6 张存在的本地图片，且不得超过模型参考图上限")
            if sum(path.stat().st_size for path in args.image) > 32 * 1024 * 1024:
                parser.error("参考图文件合计不能超过 32 MiB")

    try:
        from openai import APIConnectionError, APIStatusError, OpenAI
    except ImportError:
        parser.exit(2, "请先安装依赖：python -m pip install openai\n")

    try:
        with OpenAI(api_key=api_key, base_url=base_url, timeout=270.0, max_retries=0) as client:
            if args.command == "models":
                models = client.models.list()
                for model in models.data:
                    print(model.id)
                if not models.data:
                    print("当前 Key 暂无可用图片模型，请检查模型开放状态和 Key 白名单")
                return

            print("请求编号:", args.idempotency_key, flush=True)
            print("将创建或恢复同一编号的图片任务；请保存该编号和原请求内容。", flush=True)
            payload = dict(
                model=args.model,
                prompt=args.prompt,
                n=1,
                size="auto",
                quality="auto",
                response_format="b64_json",
                extra_headers={"Idempotency-Key": args.idempotency_key},
            )
            with ExitStack() as stack:
                if args.command == "edit":
                    files = [stack.enter_context(path.open("rb")) for path in args.image]
                    response = client.images.with_raw_response.edit(image=files[0] if len(files) == 1 else files, **payload)
                else:
                    response = client.images.with_raw_response.generate(**payload)
                print("任务 ID:", response.headers.get("x-task-id", "未返回"), flush=True)
                result = response.parse()
            if not result.data or not result.data[0].b64_json:
                raise ValueError("响应中没有图片，请用上面的任务 ID 查询最终结果")
            image = base64.b64decode(result.data[0].b64_json, validate=True)
            output = args.output.with_suffix(image_extension(image))
            with output.open("xb") as image_file:
                image_file.write(image)
            print("图片已保存:", output.resolve())
    except APIStatusError as error:
        print("HTTP:", error.status_code)
        task_id = error.response.headers.get("x-task-id")
        if task_id:
            print("任务 ID:", task_id)
        print(error.message)
        if error.status_code == 504:
            print("等待超时，任务仍会继续。请查询旧版任务接口；再次请求时复用原幂等键和全部参数。")
        parser.exit(1)
    except APIConnectionError:
        parser.exit(1, "连接中断或超时。任务可能已创建；重试时复用原幂等键和全部参数，不要更换请求编号。\n")
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
