# 官方技能接入方案：材质插画 + 人像导演

> 定稿日期：2026-10-06　状态：第 1 期已完成（2026-10-06，本地已导入并出小样）；第 2 期未开始
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
- frontmatter 字段：`name`（调用名）、`description`（简介）、`metadata.display-name`（中文名，注意是连字符；解析也兼容 `displayName`，但不认 `display_name`）、`metadata.tags`、`metadata.category`；正文为 frontmatter 之后的 Markdown。

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
- 测试：`go test ./internal/prompt/`、`npm run test:skill-composition`、admin 导入导出解析测试；e2e `apps/web-react/tests/e2e/skills-demo.spec.js` 通过。

### 4.5 第 1 期实现记录（2026-10-06）

- 后台：`apps/admin/src/utils/skillMarkdown.ts` 移植用户端的解析 / 导出（后台 Docker 构建上下文只有 `apps/admin`，不能直接引用用户端代码）；`apps/admin/scripts/test-skill-markdown.mjs`（`npm run test:skill-markdown`）用同一组样例交叉比对两端实现，两边改动必须同步。`ImageSkillsView.vue` 新增“导入 SKILL.md”、行内“导出”（`<slug>.SKILL.md`）、勾选后“导出所选”（zip，每个技能一个 `<slug>/SKILL.md`）。导入时调用名已存在会提示覆盖更新，覆盖时保留原技能的适用页面、排序和启用状态。
- 两份官方技能源文件：`apps/server/internal/prompt/skills/female-portrait-director/SKILL.md`、`apps/server/internal/prompt/skills/material-illustration/SKILL.md`（含 `NOTICE.md`）。这两个目录是后台导入的唯一来源。MIT / 授权署名写在 `description` 里，复制或导出后仍保留；正文不放署名，避免发给模型。
- 人像导演 SKILL.md 正文与 `portrait_director.go` 常量逐字一致，由 `portrait_director_test.go` 校验。
- **“再来一次”说明**：文生图的技能控件目前整体隐藏（`SHOW_GENERATION_SKILL_CONTROLS = false`），提交时 `selectedSkillIds` 被置空，所以早在本次改动之前，历史任务重跑就已经不带 `female-portrait-director`。`applyT2ISkills` 只对仍带旧参数的已入库任务（如服务端重试）生效。4.4 节里“历史任务再来一次仍带人像导演约定”这一条按此理解，不另做前端白名单。
- 材质插画正文约 1,650 字（比原计划的 2,500–3,000 字短）。用户端展开时技能正文加用户输入的总长上限为 6,000 字，超出时会整段丢弃技能，正文短一些，长文场景下更不容易被丢掉。

### 4.6 本地小样（2026-10-06，gpt-image-2，1:1 / 1K，共 6 张 6 积分）

| 小样 | 结果 |
|---|---|
| 流程（选题→写作→审核→发布） | 标签 4/4 正确，结构、配色符合 |
| 循环（用户提示→AI 执行→结果检查→下一轮） | 标签 4/4 正确 |
| 柱状图（门店数 120/185/260/410，纵轴 0–500，刻度 100） | 数值、坐标、单位全部正确；多出一个“门店数”标签 |
| 杠杆原理（支点/动力/阻力/动力臂/阻力臂） | 标签 5/5 正确；**“阻力”箭头画在石头上且朝上**，动力臂起点未对准动力作用线 |

第一轮发现标签牌被画成强调色底白字、杠杆图出现写实真人，于是在正文补了三条：标签牌不用强调色填充、黑色文字；人物做成灰色哑光小人偶；科学图按中学教材画法标力和力臂。重跑流程图和杠杆图后，前两条已生效，力的方向仍会出错。结论：科学机制图的物理细节不能只靠正文保证，留给第 2 期助手的看图检查（`qa-checklist.md`）。

### 4.7 官方技能只教用法、正文由服务端展开（2026-10-06）

要求：官方技能对用户只展示“怎么用”，正文不给用户看。光在界面上隐藏不够（接口和任务记录里都有正文），所以 `@` 官方技能改为服务端展开。

- **使用说明**：`image_skills.usage_guide`（迁移 `00191`，≤ 2000 字），后台表单“使用说明”可编辑；SKILL.md 里写在 `metadata.usage: |` 多行块，两端解析 / 导出同步支持。
- **接口**：`GET /me/image-skills` 对官方技能不再返回 `instruction`（以及 `taskTypes`、`sort`），改为返回 `usageGuide`；后台接口不变。
- **用户端**：官方技能详情只显示简介、调用写法、使用说明；以 `@` 开头的行作为示例，可一键复制；底部是“去文生图 / AI 电商 / AI 助手 / 无限画布使用”。去掉了正文、SKILL.md、导出和“复制到本地 / 云端”（`moveSkill` 也拒绝复制官方技能）。自己的技能不变。
- **展开**：前端 `expandSkillMentionsInText` 只展开自己的技能，官方技能的 `@名称` 原样留在提示词里。服务端 `internal/skillmention` 按与前端一致的规则识别并展开：
  - 文生图 / 电商任务：worker 在 `prompt.Compile` 前展开（`taskPromptWithSkills`），任务表只存用户写的文字；
  - 助手出图模式直接调上游的 3 处同样展开（`assistantImagePromptWithSkills`）；
  - 助手对话 / 智能体 / 画布智能体：`prepareAssistantContext` 把本轮 `@` 到的官方技能正文作为保密系统说明加入，并要求模型不复述原文、生成图片时在提示词里写 `@技能名` 交给任务展开。
- **残留风险**：模型理论上仍可能被诱导泄露部分规则；上游返回的 `revised_prompt` 也可能转述规则。本次改动之前创建的任务，记录里仍带展开后的正文。

### 4.8 参考资料（2026-10-07，第 2 期里先做的一部分）

只做“参考资料存储 + 后台管理 + 助手按需读取”，方案卡片、出图后看图检查等流程仍未做。与 5.1–5.3 的原设计相比有三处调整：

- **存储用表，不用对象存储**：`image_skill_references`（迁移 `00193`，主键 `(skill_id, path)`，删技能级联删除）。路径只允许 `references/` 或 `assets/` 下的 `.md` / `.txt`；单份 ≤ 64 KB，每个技能 ≤ 20 份、合计 ≤ 512 KB。文本小、要和技能一起事务写入，放表里比对象存储简单。
- **用途写在 SKILL.md 里**：`metadata.reference-notes` 逐行写“路径: 什么时候读”，导入导出都带上；后台也可单独编辑。
- **不加 `skillRefs`**：工具在服务端按本轮消息里的 `@` 判断能读哪些技能（与 4.7 的展开规则一致），前端不用改。

实现：后台 `GET/PUT /api/v1/admin/image-skills/:id/references`；编辑器新增“参考资料”分区（添加 / 替换 / 删除 / 编辑用途 / 查看，即时保存）；zip 导入导出带 `references/`、`assets/`，带资料的技能单个导出也改为 zip。助手（v2 引擎）在本轮 `@` 到带资料的官方技能时，系统说明里列出资料清单，并提供 `read_skill_reference(skill, path)`；只能读清单内的文件，结果按不可信参考处理、不向用户复述，工具步骤只记录参数不记录内容。画布智能体和旧引擎暂不提供这个工具。

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
