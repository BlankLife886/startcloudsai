# 官方技能接入方案：材质插画 + 人像导演

> 定稿日期：2026-10-06　状态：方案已定，未开始实现
> 相关文档：[技能库现状](SKILL_PAGE_PLAN.md)、[AI 助手 v2 交接](AI_ASSISTANT_V2_HANDOFF.md)

## 1. 目标

1. 把歸藏的材质插画 skill（[op7418/guizang-material-illustration](https://github.com/op7418/guizang-material-illustration)，接入时上游提交 `cf26e19`，**已获作者授权**）接入成**官方技能**，用户在任意输入框 `@材质插画` 直接使用。
2. 把**人像导演**从文生图的内置开关里移除，改成官方技能，同样用 `@人像导演` 调用。
3. 官方技能通过后台**导入 / 导出**录入，不写数据库迁移来预置技能数据。

## 2. 已定决策

| 决策 | 内容 |
|---|---|
| 调用方式 | 统一用技能库的 `@` 提及；不在文生图里保留单独开关。 |
| 适用范围 | 官方技能**不限页面**：`taskTypes` 留空（= 全部可用），文生图、AI 电商、AI 助手、无限画布都能 `@`。 |
| 录入方式 | 后台技能管理页新增导入 / 导出，格式与用户端技能库的 SKILL.md 一致（同一份文件两端都能导入）。不写预置数据的迁移。 |
| 人像导演 | 从文生图开关列表移除；正文（MIT，保留署名）作为官方技能导入。服务端 `applyT2ISkills` 暂时保留，只为让带 `skillIds: ["female-portrait-director"]` 的**历史任务**点“再来一次”时行为不变。 |
| 材质插画 | 采用**两层结构**：正文（所有入口生效）+ 参考资料（只在 AI 助手里按需读取）。分两期做，第 1 期只上正文。 |
| 来源与授权 | 仓库内保留 NOTICE：`apps/server/internal/prompt/skills/material-illustration/NOTICE.md`，写明上游地址、提交号、授权情况、本项目的改编方式。 |

## 3. 现状（代码核对）

- 官方技能表 `image_skills`：`owner_user_id IS NULL` 即官方；正文 `instruction` ≤ 4000 字，简介 ≤ 500 字，调用名 `slug` 官方全局唯一；`task_types` 空数组 = 全部页面。**没有存放附件 / 参考资料的字段。**
- 后台 `apps/admin/src/views/ImageSkillsView.vue`：有增删改查，**没有导入导出**。
- 用户端 `apps/web-react/src/features/skills/skillComposition.js` 已有 `parseSkillMarkdown`（解析 SKILL.md frontmatter）和 `serializeSkillMarkdown`（导出 Codex 兼容 SKILL.md）。
- `@` 展开在**前端**完成（`skillLibrary.js` → `expandSkillMentionsInText`），服务端只收到展开后的文本，不知道用户 `@` 了哪个技能。
- 人像导演：前端 `legacy-modules/features/ai-wallpaper/skills/wallpaperSkills.js` 中的 `serverManaged` 项；服务端 `apps/server/internal/prompt/portrait_director.go` 按任务参数 `skillIds` 拼接约定。

## 4. 第 1 期：导入导出 + 两个官方技能（正文）

### 4.1 后台导入导出

- **导入**：后台技能管理页加“导入”按钮，接受 `.md` / `.markdown` / `.txt`（单个 SKILL.md）。解析后填入现有编辑表单，管理员检查后再保存（与用户端行为一致）。调用名已存在时提示“覆盖更新 / 取消”，不静默新建重复项。
- **导出**：列表每行和批量选择都可导出 SKILL.md；批量导出为 zip（每个技能一个 `<slug>/SKILL.md`）。
- **解析代码复用**：把 `parseSkillMarkdown` / `serializeSkillMarkdown` 抽成两端共用的纯函数（或在 admin 内移植一份并共用同一组测试样例），保证两边格式一致。
- frontmatter 字段：`name`（调用名）、`description`（简介）、`metadata.display_name`（中文名）、`metadata.tags`、`metadata.category`；正文为 frontmatter 之后的 Markdown。

### 4.2 人像导演迁移

1. 用 `portrait_director.go` 中的约定原文生成 `female-portrait-director/SKILL.md`（中文名“人像导演”，保留 MIT 署名说明），在后台导入为官方技能。
2. 前端从 `BUILTIN_WALLPAPER_SKILLS` 删除人像导演；`normalizeSelectedWallpaperSkillIds` 会把历史草稿里的旧 id 过滤掉，需补一条测试确认不报错。
3. 服务端 `applyT2ISkills` 保留并加注释：仅兼容历史任务，新任务不再带该 id。等历史任务不再需要“再来一次”时另行删除。
4. 同一请求里**不会重复拼接**：新任务只有 `@` 展开这一条路径。

### 4.3 材质插画正文（约 2,500–3,000 字）

正文会被直接拼给生图模型（文生图、电商、画布），所以只写**生图模型能直接执行的约束**，去掉原 skill 里面向 Agent 的步骤（“读某个参考文件”“出图后检查”“先联网查资料”）。内容：

1. **风格**：瑞士杂志风 3D 材质插画；米白背景、黑色线条、灰色物理质感、柔和棚拍光、轻微接触阴影；物体像小型实体模型，不像扁平 App 界面。
2. **强调色**：整张图只用一种，默认 IKB 蓝 `#002FA7`；用户在需求里点名时可换为安全橙 `#FF6B35`、柠檬绿 `#C5E803`、柠檬黄 `#FFD500`、信号红 `#E60012`。
3. **中文标签**：3–5 个简体中文短标签，每个 2–5 字（最多 6 字），横排、大字、高对比，放在对应物体旁的留白或白色标签牌上，远离边缘；不出现标签以外的文字、英文、图例段落。用户已给出标签时**一字不改**。
4. **结构**：只选一种——循环、流水线、中心辐射、前后对比、分层堆叠、数据场景、科学机制、文本场景；不把多种隐喻堆进一张图。
5. **图表**：用户给出数据时，图表类型、数值、坐标范围、刻度、单位、类别顺序必须照抄，不推测、不近似；场景道具不得遮挡坐标轴、数值和箭头。
6. **构图**：主体完整、四周留足安全边距、垂直居中、不裁切；画幅以任务参数为准。
7. **禁止项**：Logo、水印、伪造品牌标志、海报边框、页面大标题、装饰色块、渐变背景、散景；严肃主题（工作、科学、金融、政策）不用卡通角色。
8. **在 AI 助手里使用时**（一小段，生图模型会忽略）：长文先挑 1 个最值得配图的概念，确定结构和标签后再出图；需要多张时先给出图方案。

正文写好后，在本地文生图实际出 3–5 张图（流程、循环、柱状图、中学物理机制各一张），检查中文标签和数值；有问题就改正文再试。

### 4.4 第 1 期验收

- 后台导入两份 SKILL.md 成功；导出后再导入，内容一致。
- 用户端技能库能看到两个官方技能，四个入口都能 `@` 到。
- 文生图不再出现人像导演开关；历史任务“再来一次”仍带人像导演约定（服务端测试覆盖）。
- 测试：`go test ./internal/prompt/`、`npm run test:skill-composition`、admin 导入导出解析测试；e2e `tests/e2e/skills-demo.spec.js` 通过。

## 5. 第 2 期：参考资料 + 助手按需读取

### 5.1 存储（不改表）

- 参考资料存对象存储：`skills/<skill_id>/references/<file>.md`，外加 `skills/<skill_id>/manifest.json`（文件名、标题、一句话用途、大小、sha256）。
- 后台导入支持 **zip 整包**：`SKILL.md` 进正文，`references/*.md`、`assets/*.md` 进对象存储；只接受 `.md` / `.txt`，单文件 ≤ 64 KB，总计 ≤ 512 KB，拒绝脚本、可执行文件、路径穿越。导出时打包回原结构。
- 材质插画导入的参考资料：`visual-style.md`、`prompt-patterns.md`、`chart-beautify.md`、`use-cases-and-routing.md`、`reference-gathering.md`、`qa-checklist.md`、`assets/prompt-template.md`。

### 5.2 让服务端知道用户 `@` 了哪些技能

- 前端展开 `@` 时，同时把命中的技能 id 列表随请求发送（助手为 `createAssistantRun` 的 `skillRefs`）。
- 服务端校验：只接受官方技能或本人的技能，最多 8 个；不认识的 id 直接忽略。

### 5.3 助手工具 `read_skill_reference`

- 只读工具，注册在 `apps/server/internal/assistanttools/`；参数 `skill`（调用名）+ `file`（manifest 里的文件名）。
- 只能读**本轮 `skillRefs` 里的技能**的资料；不能列出或读取其它技能。
- 回合开始时把 manifest（文件名 + 一句话用途）放进上下文，正文按需读取，不一次性全部塞入。
- 读到的内容按**不可信输入**处理：只作写作参考，不能提升权限、不能开启其它工具、不能改变付费确认规则。

### 5.4 材质插画在助手里的完整流程

1. 用户 `@材质插画` 并贴文章 / 周报 / 图表截图 / 数据。
2. 助手读 `use-cases-and-routing.md` 挑 1–4 个概念；图表读 `chart-beautify.md`，只抽取数据，看不清的值明确标出。
3. 冷门概念、品牌、科学装置等用现有联网搜索补事实（按 `reference-gathering.md`）。
4. 按 `prompt-patterns.md` 写每张图的提示词，给出**出图方案卡片**（标签、结构、强调色可改），走现有付费确认（逐步确认 / 按任务预算）。
5. 出图后用看图模型对照 `qa-checklist.md` 核对标签和数值；不一致自动重生成 1 次（计入预算），仍不通过就在结果里标注，由用户决定。
6. 结果保存到素材库，最终提示词随结果保存，可“再来一张”。

### 5.5 第 2 期验收

- zip 导入 / 导出往返一致；恶意 zip（路径穿越、超大、非文本）被拒绝。
- 未 `@` 的技能、他人私有技能的资料读不到（越权测试）。
- 助手端到端（模拟接口）：文章 → 方案卡片 → 确认 → 出图 → 检查结果展示。
- 真实小样：3 篇文章、2 组图表数据跑通，记录标签正确率、数值正确率、费用和耗时。

## 6. 暂不做

- 文生图里用对话模型先把长文改写成出图提示词（效果好但每次多一次对话费用，且改动文生图原流程）；第 2 期效果验证后再评估。
- 技能参考资料在文生图 / 电商 / 画布中生效（这些入口直接面向生图模型，用不上）。
- 删除 `portrait_director.go`（等历史任务兼容不再需要时再删）。

## 7. 开发顺序

1. 后台导入导出（单个 SKILL.md + 批量导出 zip），两端共用解析逻辑与测试。
2. 文生图移除人像导演开关；服务端兼容注释与测试。
3. 编写并导入 `female-portrait-director/SKILL.md`、`material-illustration/SKILL.md`；加 NOTICE；本地小样出图调正文。
4. 第 2 期：zip 导入参考资料 → `skillRefs` → `read_skill_reference` → 助手流程与检查。
