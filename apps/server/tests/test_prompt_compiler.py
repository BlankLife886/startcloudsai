"""prompt 编译模板。"""
from app.services.prompt_compiler import compile_prompt


def test_t2i_passthrough():
    prompt, size = compile_prompt("t2i", "一只猫", {})
    assert prompt == "一只猫"
    assert size is None


def test_size_extracted_from_params():
    _, size = compile_prompt("t2i", "一只猫", {"size": "1024x1024"})
    assert size == "1024x1024"


def test_type_templates_include_user_prompt():
    for task_type in ("coloring", "ui_design", "model_sheet", "game_art", "puzzle"):
        prompt, _ = compile_prompt(task_type, "USERPROMPT", {"style": "赛博朋克"})
        assert "USERPROMPT" in prompt
        assert "赛博朋克" in prompt
        assert prompt != "USERPROMPT"
