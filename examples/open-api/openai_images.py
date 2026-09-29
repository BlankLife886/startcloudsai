"""OpenAI Images compatibility example. Only generate/edit commands use paid image calls."""

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
    raise ValueError("返回的图片格式无法识别；请检查上游返回的图片数据")


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("models", help="只读取可用模型，不创建图片任务")
    for name in ("generate", "edit"):
        command = commands.add_parser(name, help="请求一张图片，会按站内价格消耗积分")
        command.add_argument("--model", required=True, help="模型名（models 命令的输出）")
        command.add_argument("--prompt", required=True)
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
        parser.error("Base URL 应为 https://你的域名/v1")
    if location.scheme != "https" and not (location.scheme == "http" and location.hostname in ("localhost", "127.0.0.1", "::1")):
        parser.error("远程调用必须使用 HTTPS，本机测试可用 HTTP")
    if api_key.startswith("demo_"):
        parser.error("演示 Key 不能调用真实 API；请在真实控制台创建测试 Key")

    if args.command != "models":
        if not args.prompt.strip():
            parser.error("提示词不能为空")
        if not args.output.parent.is_dir():
            parser.error("输出目录不存在，请先创建目录")
        # Check all supported extensions before making a paid request. Never overwrite.
        if any(path.exists() for path in {args.output, *(args.output.with_suffix(ext) for ext in (".png", ".jpg", ".webp"))}):
            parser.error("输出图片已存在，请选择新的输出名称")
        if args.command == "edit" and any(not path.is_file() for path in args.image):
            parser.error("参考图文件不存在；张数以模型的参考图上限为准")

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

            print("请求会直接转发到图片上游；失败不扣费，网关和本脚本都不会重试。", flush=True)
            payload = dict(
                model=args.model,
                prompt=args.prompt,
                n=1,
                size="auto",
                quality="auto",
                response_format="b64_json",
            )
            with ExitStack() as stack:
                if args.command == "edit":
                    files = [stack.enter_context(path.open("rb")) for path in args.image]
                    response = client.images.with_raw_response.edit(image=files[0] if len(files) == 1 else files, **payload)
                else:
                    response = client.images.with_raw_response.generate(**payload)
                result = response.parse()
            if not result.data or not result.data[0].b64_json:
                raise ValueError("响应中没有图片数据")
            image = base64.b64decode(result.data[0].b64_json, validate=True)
            output = args.output.with_suffix(image_extension(image))
            with output.open("xb") as image_file:
                image_file.write(image)
            print("图片已保存:", output.resolve())
    except APIStatusError as error:
        print("HTTP:", error.status_code)
        print(error.message)
        if error.status_code in (502, 504):
            print("上游失败或超时，本次不扣费；需要时重新运行即可。")
        parser.exit(1)
    except APIConnectionError:
        parser.exit(1, "连接中断或超时，本次不扣费；需要时重新运行即可。\n")
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
