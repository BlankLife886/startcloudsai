"""按任务类型把用户输入编译为最终 prompt。

每种类型一个中文模板函数；params 中的尺寸/风格等拼入 prompt 或作为
size 参数返回。返回 (final_prompt, size)。
"""
from typing import Any


def _style_suffix(params: dict[str, Any]) -> str:
    parts = []
    style = params.get("style")
    if style:
        parts.append(f"整体风格：{style}。")
    palette = params.get("palette")
    if palette:
        parts.append(f"配色方案：{palette}。")
    extra = params.get("extra")
    if extra:
        parts.append(str(extra))
    return " ".join(parts)


def _size_of(params: dict[str, Any]) -> str | None:
    size = params.get("size")
    return str(size) if size else None


def compile_t2i(prompt: str, params: dict[str, Any]) -> str:
    """文生图：用户 prompt 直通，附加风格参数。"""
    suffix = _style_suffix(params)
    return f"{prompt}\n{suffix}".strip() if suffix else prompt


def compile_coloring(prompt: str, params: dict[str, Any]) -> str:
    """插画上色：参考图 + 上色指令。"""
    parts = [
        "请为参考图中的线稿/插画上色，保持原始构图、线条与人物特征不变，",
        "只做上色与光影渲染，不要改变画面内容。",
        f"上色要求：{prompt}",
    ]
    suffix = _style_suffix(params)
    if suffix:
        parts.append(suffix)
    return " ".join(parts)


def compile_ui_design(prompt: str, params: dict[str, Any]) -> str:
    """UI 设计稿。"""
    platform = params.get("platform", "Web")
    parts = [
        f"请设计一张高保真的 {platform} UI 设计稿，布局规范、层级清晰、",
        "视觉现代，包含真实可信的界面文案与组件细节。",
        f"设计需求：{prompt}",
    ]
    suffix = _style_suffix(params)
    if suffix:
        parts.append(suffix)
    return " ".join(parts)


def compile_model_sheet(prompt: str, params: dict[str, Any]) -> str:
    """超高清模型参考图（多视角 model sheet）。"""
    views = params.get("views", "正面、侧面、背面")
    parts = [
        "请生成一张超高清角色/物体模型参考图（model sheet），",
        f"在同一画面中以 {views} 等多个视角展示同一对象，",
        "各视角比例一致、细节统一，白底或浅色纯色底，便于三维建模参考。",
        f"对象描述：{prompt}",
    ]
    suffix = _style_suffix(params)
    if suffix:
        parts.append(suffix)
    return " ".join(parts)


def compile_game_art(prompt: str, params: dict[str, Any]) -> str:
    """游戏素材。"""
    asset_type = params.get("assetType", "游戏美术素材")
    parts = [
        f"请生成可直接用于游戏开发的{asset_type}，",
        "画面完整、主体突出、边缘干净，适合作为游戏资源使用。",
        f"素材描述：{prompt}",
    ]
    suffix = _style_suffix(params)
    if suffix:
        parts.append(suffix)
    return " ".join(parts)


def compile_puzzle(prompt: str, params: dict[str, Any]) -> str:
    """AI 拼图合成：多张参考图合成一张。"""
    layout = params.get("layout", "自然融合")
    parts = [
        "请把提供的多张参考图智能合成为一张完整、和谐的图片，",
        f"采用「{layout}」的方式组合，过渡自然、光影统一、无明显拼接痕迹。",
        f"合成要求：{prompt}",
    ]
    suffix = _style_suffix(params)
    if suffix:
        parts.append(suffix)
    return " ".join(parts)


_COMPILERS = {
    "t2i": compile_t2i,
    "coloring": compile_coloring,
    "ui_design": compile_ui_design,
    "model_sheet": compile_model_sheet,
    "game_art": compile_game_art,
    "puzzle": compile_puzzle,
}


def compile_prompt(task_type: str, prompt: str, params: dict[str, Any] | None) -> tuple[str, str | None]:
    params = params or {}
    compiler = _COMPILERS.get(task_type, compile_t2i)
    return compiler(prompt, params), _size_of(params)
