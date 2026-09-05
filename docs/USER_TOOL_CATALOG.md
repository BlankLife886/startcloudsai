# 用户工具目录

用户端入口：`/ai-tools`。首页「实用工具」中的「全部工具」会打开该页面。

目录由前端基础清单和后台运行时媒体工具共同组成：

- 基础工具会随代码版本更新。
- 后台新增或下线的媒体工具会从运行时配置动态增减，不需要修改此文档页。
- 所有会修改工作区、开始生成、产生费用或导出文件的 Agent 动作，都会先显示确认卡；用户确认前不会执行。
- AI 助手不提供任意 Shell、SQL、后台管理、支付或不受限制的浏览器控制。

## AI 助手

对话与创作：连续对话、图片生成与编辑、图片创作方案、消息排队、语音输入、清除上文、PPT 制作、PSD 制作。

内置工具：

- `web_search`：联网检索并保留来源。
- `task_status`：查询本人任务真实阶段、耗时、重试、失败、扣费与退款。
- `files_list`、`files_search`、`files_read`：附件清单、检索和精读。
- `files_create`：生成 TXT、Markdown、CSV、JSON 和 PPTX。
- `media_action`：抠图、压缩、放大、裁剪和切图操作入口。
- `image_search`：公开图库图片搜索，显示来源和授权。
- `webpage_capture`：公网网页视觉截图。
- `send_to_workspace`：把需求和图片发送到其他创作工作区。
- `reference_rebuild`：从参考图创建无限画布复刻草稿。
- `product_import`：读取公开商品页并准备导入 AI 电商。
- `delivery_export`：本地打包图片、提示词、参数和清单。
- `site_operator`：只在允许的用户端页面之间跳转。

## 无限画布

界面能力：节点编辑、连线与多选、外部文本/截图粘贴、智能切图、高清放大、裁剪、多角度和反推提示词。

全部 Agent 工具：

`canvas_reply`、`canvas_get_state`、`canvas_get_selection`、`canvas_find_nodes`、
`canvas_inspect_nodes`、`canvas_inspect_visuals`、`canvas_focus_nodes`、`canvas_apply_ops`、
`canvas_duplicate_selection`、`canvas_create_image_operation`、`canvas_update_generation_settings`、
`canvas_create_attachment_nodes`、`canvas_replace_workflow_input`、`canvas_run_generation`、
`canvas_regenerate_selection`、`canvas_run_downstream`、`canvas_generation_status`、
`canvas_plan_workflow_run`、`canvas_validate_workflow`、`canvas_run_workflow`、
`canvas_workflow_status`、`canvas_stop_workflow`、`canvas_resume_workflow`、
`canvas_retry_failed_nodes`、`canvas_undo_last_action`、`canvas_redo_last_action`、
`canvas_create_checkpoint`、`canvas_restore_checkpoint`、`canvas_list_agent_history`、
`canvas_restore_agent_transaction`、`canvas_export_snapshot`、`canvas_list_projects`、
`canvas_list_workflow_templates`、`canvas_inspect_workflow_template`、
`canvas_create_from_workflow_template`、`prompts_search`、`assets_list`、`assets_add`、
`site_navigate`、`web_search`。

## 业务创作

通用创作：文生图、插画染色、UI 设计稿、模型设计、游戏设计。

AI 电商：AI 创意商拍、商品套图、爆款图复刻、A+ / 详情页、AI 营销图、AI 背景图、智能扩图、真实增强、AI 虚拟试衣、手持商品图、AI 饰品穿戴、背景复刻、AI 商品阴影。

## 平台与实用工具

背景移除、图片压缩、拼图、我的资产、提示词库、生成历史、作品社区、开放 API、钱包与账单，以及后台动态配置的图片、视频和音频媒体工具。

页面展示的数量是最终准数：它会把代码内置工具与当前后台动态配置工具合并后实时统计。
