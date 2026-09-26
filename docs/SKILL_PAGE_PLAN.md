# 技能库现状与后续规划

代码核对日期：2026-09-22。`/skills` 已是可持久化的真实技能库，不再是固定示例 Demo。技能是可复用的文本指令；输入框展示名称和简介，提交时按 `@名称` 或 `@调用名` 展开正文，不单独执行脚本或安装系统插件。

## 当前已实现

| 位置 | 存储与额度 | 操作 |
| --- | --- | --- |
| 本地 | 当前浏览器 `localStorage`，最多 50 条；未登录可用，不是账号云端同步 | 新建、编辑、删除、导入、导出、移到云端 |
| 云端 | 当前账号，界面读取接口 `maxOwned`；服务端当前常量上限 5 条，客户端兜底同为 5，不是后台可配置项 | 新建、编辑、删除、移到本地 |
| 官方 | 服务端返回的已发布官方技能，客户端随登录后的技能库接口读取 | 只读，可复制到本地或云端再改 |

页面支持按存储位置筛选、搜索名称/简介/调用名/标签、详情查看正文或 `SKILL.md`、复制提及及 Markdown、创建和修改。导入 `.md`、`.markdown`、`.txt` 后先填入编辑表单，保存前可检查；上限 256 KB，名称 64 字、简介 500 字、正文 4000 字。调用名为小写字母开头的字母/数字/连字符格式，最长 64 字符。

支持 `@` 的入口为文生图、AI 电商、AI 助手、无限画布；不再先绑定页面或装载技能。每条提示词最多识别 8 项，正文去重后拼在具体用户需求前，超长组合优先保留用户需求。云端读取失败时显示重试，本地技能继续可用；提及展开失败不会阻断原始提交。费用、权限、模型与任务状态继续由原有生成/助手/画布管线处理，保存或选择技能本身不创建收费任务。

当前接口（均以 `/api/v1` 为前缀）：

- 登录用户：`GET/POST /me/image-skills`，`PATCH/DELETE /me/image-skills/:id`。
- 管理员：`GET/POST /admin/image-skills`，`PATCH/DELETE /admin/image-skills/:id`；后台页面为 `/admin/image-skills`。

实现入口：`apps/web-react/src/views/SkillsView.jsx`、`apps/web-react/src/features/skills/skillLibrary.js`、同目录的 `skillComposition.js`、`useMentionMenu.js`、`MentionMenu.jsx`；画布提及适配在 `apps/web-react/src/canvas/lib/image-skill-mentions.ts`。服务端见 `handlers_image_skills.go`、`store/imageskills.go` 及迁移 `00153_image_skill_slug.sql`、`00154_drop_user_skill_bindings.sql`。旧页面绑定已移除，不能继续依赖 `SkillBindingBoard`、`SkillPickerDialog` 或 `skillRuntime`。

验证入口为 `npm run test:skill-composition`（包含技能库测试）及 `tests/e2e/skills-demo.spec.js`（文件名保留历史命名，内容已覆盖真实技能库）。本次只校正文档，未宣称这些检查已重新通过。

## 后续规划边界

以下保留早期可执行 Skill 产品蓝图，章节中的版本表、审核、报价、专属运行记录、`/skills/:slug`、`/skills/mine` 和 `/admin/skills` 均不是当前实现。现有官方技能维护和用户云端 CRUD 已落地，但不等于下述完整版本发布/执行契约已落地。

## 规划 1. 可执行 Skill 产品目标

把“提示词 + 输入参数 + 可调用工具 + 输出要求”组织成可版本化、可复用的创作任务。例如商品主图、角色设定、线稿配色、品牌视觉和 PSD 拆层。用户选 Skill、填写参数、确认预计积分后执行，不需要理解 Agent 工具协议。

与已有功能的区别：提示词库只提供文字；画布模板提供节点图；Skill 提供可执行任务契约，可以引用提示词或画布模板，但不能把三份内容复制成彼此失去同步的版本。

## 规划 2. 可执行 Skill 首版边界

- 官方审核后发布，用户可收藏与复制为私人草稿。
- 首版仅声明式输入和受控工具，不上传或执行 Python、shell、npm 包、浏览器脚本。
- 支持文本、图片引用、枚举、整数、布尔输入；文件引用必须校验本人所有权。
- 执行入口为现有助手运行管线或已验证的画布模板，复用钱包、队列、取消和文件权限。
- 不上线付费 Skill 分成、多作者协作、公开自由发布、第三方 MCP 任意工具安装。

## 规划 3. 页面结构

规划扩展 `/skills` 为执行型目录，不做营销落地页；下列收藏、版本、报价和独立详情路由不是当前文本技能库的界面契约。桌面最低视口沿用项目策略。

顶部：Skill 标题、搜索、分类筛选、收藏/全部切换。主体为紧凑列表或3列重复项目卡片，显示名称、封面、用途、版本、所需输入、预计积分范围、发布状态。分类包括电商、插画、模型、游戏、文件处理。未发布内容不出现在公开目录。

`/skills/:slug`：左侧真实结果样例与输入说明，中部参数表单，右侧运行摘要，包含所选模型、预计积分、工具权限、结果格式。主操作“运行”，次操作收藏；不能在用户还没确认时自动扣费。

`/skills/mine`：私人草稿、收藏、最近运行；复制的官方Skill保留来源版本，不自动覆盖私人修改。

`/admin/skills`：搜索、分类、状态、作者筛选；新增、编辑、预览、发布、下架、版本回滚与审计。编辑已发布版本时生成新草稿。

## 规划 4. 关键数据模型

| 实体 | 主要字段 | 约束 |
| --- | --- | --- |
| skills | id, slug, owner_id, visibility, status, current_version_id | slug唯一；公开发布需审核 |
| skill_versions | id, skill_id, version, title, description, input_schema, output_schema, instruction, tool_allowlist, template_id, content_hash | 发布后不可变；版本唯一 |
| skill_assets | version_id, object_key, kind, license_note | 不接受未经鉴权的私有跨用户素材 |
| skill_favorites | user_id, skill_id | 联合唯一 |
| skill_runs | id, user_id, version_id, input_snapshot, model_snapshot, quote_snapshot, assistant_run_id/workflow_run_id, idempotency_key, status | 运行关联不可变版本；用户幂等 |
| skill_reviews | version_id, reviewer_id, result, reasons, created_at | 审核留痕 |

input_schema 使用 JSON Schema 子集；限制嵌套深度、字段数、字符串长度和数组数量。原始上传地址不直接注入指令，使用服务端解析的素材引用。

## 规划 5. 建议 API

公开：`GET /api/v1/skills`、`GET /api/v1/skills/:slug`。

登录：`PUT/DELETE /api/v1/me/skill-favorites/:id`、`POST /skills/:id/quotes`、`POST /skills/:id/runs`、`GET /skill-runs/:id`、`POST /skill-runs/:id/cancel`。

管理：`GET/POST /admin/skills`、`PUT /admin/skills/:id/draft`、`POST /admin/skills/:id/publish`、`POST /admin/skills/:id/unpublish`、`GET /admin/skills/:id/versions`。

这些是计划中的端点，不应加入当前对外 API 的“已可用”列表。

## 规划 6. 执行与计费

1. 服务端读取确切Skill版本，校验可见性、输入与素材所有权。
2. 根据模型和模板生成报价，返回版本/hash及预算上限。
3. 用户确认后，用幂等键创建skill_run并冻结预算；价格或版本变化返回409重新报价。
4. 将工具集合限制为平台允许项与Skill声明项的交集，实际执行仍逐次鉴权。
5. 通过已有助手或工作流执行器运行，保存真实工具结果和任务ID。
6. 完成后校验输出契约，成功结算、失败释放；取消按现有已发生上游成本规则处理，不承诺无条件退款。

禁止把Skill文本提升成系统权限。工具返回内容与上传文档均是不可信输入；无法修改服务端额度或自行开启工具。

## 规划 7. 状态与异常

目录：加载、无结果、服务异常重试、收藏失败、下架状态。
详情：缺参数、文件过大、余额不足、模型不可用、报价失效、Skill新版本提示。
运行：queued/running/succeeded/failed/canceled，显示真实阶段与错误，不使用虚假完成百分比。
运行中刷新通过run_id恢复；历史结果保留对应旧版本信息。

## 规划 8. 发布门禁与验收

- 开放画布型 Skill 前，应以最新回归验证工具重放、检查点内容版本和插件能力边界。相关保护已有实现，不能继续把历史审查中的所有问题当作尚未修复；参见 [画布审查现状补充](CANVAS_AGENT_AUDIT.md)。
- 首版先发布5个经人工验证的助手型Skill，不声明所有节点或所有工具可执行。
- 自动测试：输入schema、越权文件、发布版本不可变、并发幂等、预算变化、取消退款、下架不可新建、历史可读。
- 质量集：每个Skill至少10组固定输入，记录输出格式、模型、积分、时延与失败原因；不以一次成功演示代表稳定。
- 运营门槛：展示真实封面与输出样例；明确版权与敏感内容规则；记录发布审批人。

## 规划 9. 历史开发顺序与待确认项

阶段1：数据模型、官方草稿发布、只读目录与详情。
阶段2：输入表单、报价、助手型执行、历史、收藏。
阶段3：画布能力门禁修复后增加模板型执行。
阶段4（原计划）：私人编辑器与导入导出，再评估社区市场。当前文本技能库的私人编辑器及导入导出已经实现，不能将这一原计划顺序当成现有待办。

后续待确认：是否开放用户公开发布；是否额外收取Skill价格；私人草稿与官方版本如何同步。正式市场和执行接口须在这些边界确定后继续开发。当前文本技能库不增加 Skill 附加费用，模型执行继续按原业务规则计费。
