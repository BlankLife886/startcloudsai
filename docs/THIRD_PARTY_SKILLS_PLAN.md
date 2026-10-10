# 第三方官方技能接入方案

编写日期：2026-10-07。接入方式沿用 [材质插画](MATERIAL_ILLUSTRATION_SKILL_PLAN.md)：源文件放在 `apps/server/internal/prompt/skills/<slug>/`，后台以 zip 导入为官方技能。

**进度（2026-10-07）**

- 已完成：8 个技能目录（`SKILL.md`、`NOTICE.md`、`references/`）已按第 4 节改写好，`apps/admin/scripts/test-skill-markdown.mjs` 校验每个目录都能无警告整包导入、正文不超 4000 字、每份资料有用途说明并带来源地址。来源地址字段（见第 3 节）已上线到服务端、后台和用户端。
- 已导入本地环境：8 个技能已通过后台接口导入（与后台“导入 zip”相同的解析和请求），均为启用状态，来源地址和参考资料份数与目录一致；用户端技能详情的 GitHub 图标已在浏览器中确认。
- 未完成：第 7 节的真实出图验收没做；第 5 节 P1–P3 平台能力没做；线上环境未导入。

## 1. 结论

| 技能（暂定调用名） | 上游 | 许可 | 上游提交 | 结论 |
| --- | --- | --- | --- | --- |
| 手绘 PPT（`handdrawn-ppt`） | [helloianneo/ian-handdrawn-ppt](https://github.com/helloianneo/ian-handdrawn-ppt) | MIT；NOTICE 要求保留 “Ian Handdrawn PPT” 名称或署名 Ian | `306d824` | 接入，第一个做 |
| 学术配图（`academic-figure`） | [LigphiDonk/academic-figure-generator](https://github.com/LigphiDonk/academic-figure-generator) 中的 `academic-figure-prompt`、`academic-figure-prompt-pastel` | MIT | `0a2bec6` | 接入；只取两个技能目录，后端平台不用 |
| 内容配图（`content-illustration`） | [izscc/cc2image](https://github.com/izscc/cc2image) | MIT | `33b18b3` | 接入；其中的小黑风格不搬，以 4.6 小黑配图为准 |
| 电商详情图（`ecom-details`） | [liangdabiao/ecom-details-image](https://github.com/liangdabiao/ecom-details-image)，并入 [wzj177/ecommerce-image-suite](https://github.com/wzj177/ecommerce-image-suite) 的平台规范与套图类型 | 前者无许可证文件，**已获作者授权**（2026-10-07 确认，凭据由项目方留存）；后者 Apache-2.0 | `e7aa199`、`2d508bd` | 接入，两个上游合成一个技能 |
| 小红书视觉导演（`xhs-visual-director`） | [ziguishian/xhs-visual-director-skill](https://github.com/ziguishian/xhs-visual-director-skill) | MIT | `5c730c6` | 接入；出图之外还做文案和审查 |
| 小黑配图（`xiaohei-illustrations`） | [helloianneo/ian-xiaohei-illustrations](https://github.com/helloianneo/ian-xiaohei-illustrations) | MIT；NOTICE 要求保留 “Ian Xiaohei Illustrations” 名称或署名 Ian | `4102eb8` | 接入 |
| 手绘画风（`hand-drawn-styles`） | [threerocks/hand-drawn-styles](https://github.com/threerocks/hand-drawn-styles) | MIT | `7388c55` | 接入；风格 3.1 暂缓 |
| AI 婚纱照（`wedding-photo`） | [wenyachen/ai-wedding-photo-skill](https://github.com/wenyachen/ai-wedding-photo-skill) | MIT | `e396f04` | 接入 |

**定位区分**：同类技能较多，每个技能 `description` 第一句写清与相近技能的区别。

| 技能 | 一句话定位 |
| --- | --- |
| 材质插画 | 一种固定风格的 3D 材质解释图 |
| 手绘 PPT | 一组整页演示图，封面 21:9、正文 16:9 |
| 小黑配图 | 单一 IP“小黑”的怪诞手绘正文配图 |
| 内容配图 | 多风格的文章拆图：封面加正文配图、图标 |
| 手绘画风 | 按画风配方出插画、绘本、亲子手绘 |
| 小红书视觉导演 | 整套 3:4 小红书图文，含标题、正文、标签和审查 |
| 学术配图 | 论文框架图、结构图、流程图 |
| 电商详情图 | 商品套图，按平台规范与场景模板 |
| AI 婚纱照 | 用双方人像出一组婚纱照 |

上游提交为本文核对时的 HEAD，落地时以实际复制的提交为准并写进 `NOTICE.md`。

## 2. 官方技能的运行方式（现状）

- **AI 助手（v2 引擎）**：`@` 到官方技能时，正文作为保密系统说明加入，带参考资料的技能会列出资料清单。模型在同一个智能体循环里可调用：
  - 问用户：`ask_choices`（多组、可多选，选项只能是文字）。
  - 读资料：`read_skill_reference`、`files_read` / `files_search`（用户上传的文档）、`web_search`、`image_search`、`webpage_capture`。
  - 出图：`propose_image_action`，一次提交多张，`items` 里每张独立的标题、提示词、比例、分辨率和参考图，用户确认后才扣费；`media_action`（放大、裁剪、切图）。
  - 电商：`product_import`、`competitor_analyze`、`commerce_set_plan` / `generate` / `edit` / `redo` / `status`。
  - 交付：`files_create`（txt / md / csv / json / pptx，pptx 只支持标题加要点）、`delivery_export`（ZIP）、`send_to_workspace`。
- **助手里的技能不限于出图**：可以只做规划、写文案、审查、读文件或导出文件，例如小红书视觉导演只出标题正文、只审查已有页面。
- **文生图、AI 电商、画布直接 `@`**：只把正文作为文字展开进提示词，用不上工具。所以带出图能力的技能正文要分两段：前半段是图片模型能直接执行的风格与构图约束；后半段“给 AI 助手”写流程和工具调用。
- **不支持**：执行上游的 Python / Node 脚本、HTML 渲染成图、发布到外部平台。上游的 `scripts/` 一律不搬。

## 3. 共同约束

- 署名写在 `SKILL.md` 的 `description` 末尾和 `NOTICE.md`，正文不放署名，避免发给模型。
- 上游仓库地址写在 `SKILL.md` 的 `metadata.source-url`，导入后存入技能的“来源地址”（`image_skills.source_url`，迁移 `00194`，只接受 https，后台可改，用户自建技能不开放）。用户端官方技能详情右上角显示为图标：GitHub 地址显示 GitHub 标志，其他站点显示外链图标，点击在新标签页打开。合并多个上游的技能填主上游。
- `NOTICE.md` 记录：上游地址、提交、许可证（或授权说明）、改造了什么、哪些参考资料原样复制。
- 参考资料只能是 `references/` 或 `assets/` 下的 `.md` / `.txt`，单份 ≤ 64 KB，每个技能 ≤ 20 份、合计 ≤ 512 KB。上游的 JSON 模板、`.js` 色板、图片要转成 Markdown 或放弃。
- 上游中针对 Codex / Claude Code 的指令（`image_gen`、`Visualize:visualize`、`::codex-inline-vis`、本地文件路径、读 PPTX/DOCX 插件、环境变量和 API key）全部改写为本平台工具或删除。
- 需要出图时一律走 `propose_image_action`（电商套图走 `commerce_set_*`），保持“先出方案卡、用户确认才扣费”；技能正文不能要求跳过确认。
- 不使用第三方作品的角色、品牌或工作室名作为风格名或写进提示词（例如“吉卜力”改为“日系手绘动画风”）。
- 上游的开放式提问清单：有固定选项的问题用 `ask_choices`；开放问题合并成一条消息问，并且只问会改变结果的。
- `metadata.usage` 写给用户看的用法和 `@` 示例；`metadata.reference-notes` 写每份资料“什么时候读”。

## 4. 各技能方案

### 4.1 手绘 PPT

**定位**：把文章、讲稿、课程笔记或提纲做成一组中文手绘技术风格的整页图，封面 21:9，正文 16:9，文字直接画进图里。产出是图片，不是可编辑 PPT。

**上游流程 → 本平台**

| 上游步骤 | 本平台做法 |
| --- | --- |
| 读入 Markdown / PDF / DOCX / PPTX | 用户上传后用 `files_search` / `files_read`；直接粘贴的文本直接用 |
| intake：缺关键信息时最多问 1–3 个问题 | `ask_choices`（受众、页数、封面要不要、侧重点） |
| 叙事规划、按内容选版式（slide archetypes） | 助手读 `narrative-planning.md`、`slide-archetypes.md` 后出页面清单，先给用户看再出图 |
| 逐页生成整页图 | 一次 `propose_image_action`，每页一个 `items`，封面 `ratio: 21:9`，正文 `16:9`；超过单次上限就分批 |
| 风格锚点图 | 平台能力 P1 完成前：用 `theme-tokens.json` 转成的色板与提示词约束；完成后作为每页参考图 |
| contact sheet 总览图 | 不做；改为 `delivery_export` 打包 |
| 文字不准时用确定性叠字修复 | 不做；改为对出错的单页重新出图 |

**资料**：`intake.md`、`narrative-planning.md`、`slide-archetypes.md`、`visual-dna-v6.md`、`output-quality.md`、`prompt-patterns.md` 原样复制到 `references/`；`theme-tokens.json` 改写为 `assets/theme-tokens.md`。风格锚点 PNG 等 P1 完成后再导入。

**风险**：单页中文字数多时生图模型容易写错字，正文里要限制每页字数，并在 `output-quality.md` 的检查项里强调逐字核对。

### 4.2 学术配图

**定位**：读论文或方法描述，为框架图、网络结构图、流程图、模块细节图、对比与消融图写高信息密度的英文提示词并出图。上游有两种风格：经典顶会风（`academic-figure-prompt`）和现代 ML 浅色风（`academic-figure-prompt-pastel`），合并为一个技能，风格作为选项。

**上游流程 → 本平台**

| 上游步骤 | 本平台做法 |
| --- | --- |
| 读论文 LaTeX / PDF / Word | `files_search` / `files_read`；只给片段时直接用 |
| 未指定配色时给出 8 套预设和取色工具链接 | `ask_choices`：风格（经典 / 浅色）、配色（8 套预设名）、图的类型；取色工具链接放进使用说明 |
| 生成英文详细提示词 | 同上游，写进 `propose_image_action` 的提示词 |
| 输出提示词给用户自己去别的工具生成 | 默认直接出方案卡；用户只要提示词时用 `files_create` 导出 md |

**资料**：上游两个 `SKILL.md` 正文约 17 KB 以上，超过直接展开适合的长度。正文只留风格总则和流程；配色表、各图型模板、两种风格的细则拆进 `references/`（如 `palettes.md`、`figure-types.md`、`style-classic.md`、`style-pastel.md`）。

**风险**：学术图文字和符号密集，受模型文字渲染能力限制；验收时必须用真实论文片段实测，数学符号和维度标注出错率高的图型在使用说明里提示用户自行核对。

### 4.3 内容配图

**定位**：把中文文章、选题或知识点拆成封面加若干正文配图，也可出 logo / 图标。上游内置 49 套内容风格和 8 套图标风格。与材质插画的区别：材质插画只有一种固定风格；本技能是多风格。

**上游流程 → 本平台**

| 上游步骤 | 本平台做法 |
| --- | --- |
| 强制风格门禁：未指定风格必须先弹可视化选择器 | 保留“未指定风格先问”的规则，改用 `ask_choices`：先推荐 3 套风格加“其他”，同时问封面开关与比例、正文张数；图标模式固定 1:1、1 张 |
| `build_selector.py` 生成带缩略图的 HTML 选择器 | 不搬；平台能力 P2 完成后改成带缩略图的选项 |
| `CC2IMAGE_SELECTION_V1` 配置块 | 不需要；`ask_choices` 的回答就是配置 |
| 认知锚点拆图、封面与正文提示词 | 读 `article_breakdown.md`、`cover_prompt.md`、`body_prompt.md` 后，一次 `propose_image_action`，封面和每张正文各一个 `items` |
| 批量生图清单（prompts / JSON） | 用户要清单时 `files_create` 导出 json 或 md |

**资料**：`references/` 下各 `.md` 原样复制；`style_example_assets.json` 转成 Markdown 风格索引（style_id、中文名、适用内容）。`kashika_*`、`quirky_doodle_method.md` 等风格方法文档按需读取。示例图暂不导入，P1 完成后再决定是否作为风格参考。上游的小黑示例素材和小黑相关风格不搬，用户要小黑风格时引导改用 `@小黑配图`（4.6），避免两份小黑定义不一致。

**风险**：49 套风格只能用文字描述，风格还原度依赖提示词质量，P2 前用户也看不到样张；上线前每套风格至少实测一张，效果差的风格先从推荐里去掉。

### 4.4 电商详情图

**定位**：输入商品图和需求，出主图、场景图、平铺图、细节图、海报、社媒图、直播间图等整套电商素材。合并两个上游：

- ecom-details-image 提供 25 个场景模板、Campaign Style Lock（同一组图锁定统一风格）和偏转化的文案与构图。
- ecommerce-image-suite 提供平台规范（淘宝/天猫、京东、拼多多、抖音、Amazon、独立站的尺寸、字体与配色倾向）、8 种标准图类型、商品分析和平台文案提示词。

两者重叠的部分（主图、场景图、模特图等）以 ecom-details-image 的场景模板为主，ecommerce-image-suite 补平台规范和文案。

**上游流程 → 本平台**

| 上游步骤 | 本平台做法 |
| --- | --- |
| 读商品图和需求 | 用户上传商品图；有商品链接时 `product_import`；有竞品截图时 `competitor_analyze` |
| Brief / Prompt 模式：只出视觉简报和提示词 | 助手直接回复，或 `files_create` 导出 md |
| Generate 模式：出图 | 整套图走 `commerce_set_plan` → `commerce_set_generate`，单张或零散需求走 `propose_image_action`；修改走 `commerce_set_edit` / `commerce_set_redo` |
| Campaign Style Lock | 写进技能正文：先定一套风格锁定参数（背景、光线、色调、字体倾向），套用到本组每一张的提示词 |
| 生图通道判断（Codex `imagegen` / `scripts/generate_image.py`） | 删除，只用本平台工具 |
| 25 个 `references/templates/*.json` | 转成 Markdown，按场景分组成几份（如主图与白底、场景与生活方式、详情与信息图、营销与活动），每份写明关键词、默认参数和变体 |
| suite：选择平台规范与套图类型 | `ask_choices`：目标平台、要哪几种图 |
| suite：商品视觉分析、卖点提炼 | 助手看用户上传的商品图直接分析；读 `analysis-prompts.md` |
| suite：平台文案（标题、卖点、详情文案） | 助手直接回复，或 `files_create` 导出 md / csv |
| suite：API Key 检查、`scripts/*.py`、多供应商配置 | 删除 |
| suite：详情页 HTML、产品展示视频 | 删除（平台不渲染 HTML；视频不在本技能范围） |

**资料**：ecommerce-image-suite 的 `platforms.md`、`image-types.md`（约 44 KB）、`copy-prompts.md`、`analysis-prompts.md` 复制后删去脚本、供应商和 API 相关段落；`providers.md`、`model-prompts.md` 不搬；`dynamic-prompt-architecture.md` 只取提示词组织思路，按需改写。

**授权**：ecom-details-image 无许可证文件，已获作者授权（2026-10-07），`NOTICE.md` 写明“经作者授权接入”，与材质插画的写法一致。ecommerce-image-suite 为 Apache-2.0：`NOTICE.md` 附许可证全文链接、保留版权声明，并逐份写明改动（Apache-2.0 第 4 条要求标注修改）。

**待确认**：`commerce_set_plan` 现有的套图结构和上游 25 类场景、8 种图类型的对应关系，落地前对一遍；对不上的只走 `propose_image_action`。

### 4.5 小红书视觉导演

**定位**：把选题、草稿、截图或产品图做成整套 3:4 小红书图文：判断内容任务和传播目标、选风格、规划封面/内页/结尾页、写逐页视觉方案和出图提示词，再写标题、正文、标签和评论区引导，最后按清单审查。也可以只做其中一部分：只出文案、只审查已有页面、只给某页的排版建议。

**上游流程 → 本平台**

| 上游步骤 | 本平台做法 |
| --- | --- |
| 完整规划前默认问 10 个苏格拉底式问题 | 有固定选项的（传播目标、期望读者行动、整体气质、绝对不要的风格）用 `ask_choices`；开放问题（目标读者、核心一句话、手上的素材）合并成一条消息。用户说“直接生成”时跳过 |
| 读用户的草稿、截图、产品图、已有页面 | 文档走 `files_search` / `files_read`；图片直接看对话里的图 |
| 多页先生成“统一视觉母版” | 写进方案：一组固定的风格参数，套用到每页提示词 |
| 先出 1 张视觉确认图，确认后批量 | 先 `propose_image_action` 出封面 1 张；用户认可后再出其余页，每页一个 `items`，`ratio: 3:4` |
| 标题、正文、标签、评论区引导 | 助手直接回复；要文件时 `files_create` 导出 md |
| 页面审查（高级感、可读性、收藏价值） | 读 `visual_review_checklist.md`、`anti_patterns.md`，对用户给的页面或本次生成结果逐项给结论 |
| 自动发布 | 上游没有，本平台也不做 |

**资料**：`docs/` 下 7 份（`style_system.md`、`page_structure_rules.md`、`prompt_rules.md`、`visual_consistency_protocol.md`、`socratic_questioning_protocol.md`、`final_image_generation_workflow.md`、`anti_patterns.md`）和 `templates/` 下 5 份原样复制到 `references/`；`examples/` 只取 `style_reference_notes.md` 和一份完整示例。上游 `SKILL.md` 约 20 KB，正文压缩后其余放进资料。

**风险**：3:4 竖图里中文字多时易出错，规划阶段就限制每页字数；封面确认这一步不能省，否则风格不对会整套重出。

### 4.6 小黑配图

**定位**：给中文文章配 16:9 横版正文插图，固定 IP“小黑”（黑色实心、白点眼、细腿、空表情），纯白底手绘，少量红橙蓝批注。小黑必须参与画面核心动作。

**上游流程 → 本平台**

| 上游步骤 | 本平台做法 |
| --- | --- |
| 消化正文、链接、Markdown 或截图，挑认知锚点 | 文档走 `files_search` / `files_read`；链接用 `webpage_capture` 或让用户粘贴正文 |
| 只问“怎么配图”时先给 shot list | 助手直接回复配图清单（每张：对应段落、要表达的判断、构图、标注文字），不出图 |
| 逐张生成 | 一次 `propose_image_action`，每张一个 `items`，`ratio: 16:9` |
| 生成后检查与迭代 | 读 `qa-checklist.md`，对结果逐张检查；不合格的单张用 edit 或重出 |
| `assets/examples/` 低频视觉校准 | 上游本就不进默认路径；P1 完成后可作为可选参考图 |

**资料**：`style-dna.md`、`xiaohei-ip.md`、`composition-patterns.md`、`prompt-template.md`、`qa-checklist.md` 原样复制。

**署名**：`description` 末尾与 `NOTICE.md` 保留 “Ian Xiaohei Illustrations” 名称并署名 Ian。小黑是作者的视觉 IP，技能内不改造其形象设定。

### 4.7 手绘画风

**定位**：用内置画风配方出插画、绘本、亲子手绘、讲解漫画等。上游是“提示词生成器”，本平台在此基础上直接出图；用户只要提示词时也可以只给提示词。

**画风范围**：上游 18 套加风格 3.1。首批上线 18 套中的通用画风，处理两处：

- 风格 3“吉卜力风”改名为“日系手绘动画风”，配方和提示词里去掉工作室名。
- 风格 3.1（蜡笔童涂潦草自画版）的正式生产要求锚点图加两轮修正（基础生成 → `scribble-correction` → `scribble-chaos-correction`），每轮都要用户确认并扣费，且锚点图 `anchor-family.png` 附带隐私声明。暂缓，P1 完成后再评估；锚点图不导入。

**上游流程 → 本平台**

| 上游步骤 | 本平台做法 |
| --- | --- |
| `PROTOCOL.md` 5 步：定画风 → 取配方 → 填占位符 → 处理比例 → 输出 | 写进正文；未指定画风时用 `ask_choices` 推荐 3 套加“其他” |
| `scripts/render_prompt.py` 渲染模板，禁止手工缩写或改写 | 不搬脚本；正文要求助手读 `STYLES.md` 中对应配方后**逐字**套用模板，只替换占位符 |
| 输出 prompt，不生图 | 默认出方案卡 `propose_image_action`；用户只要提示词时直接回复 |
| 附录 A 实拍纸质感增强层 | 作为可选叠加项，用户要“像真的画在纸上”时加 |

**资料**：`PROTOCOL.md`（约 12 KB）与 `STYLES.md`（约 60 KB，接近单份 64 KB 上限）放进 `references/`，`STYLES.md` 删去风格 3.1 和工作室名后再导入；`benchmarks/`、`examples/` 不搬。

**风险**：`STYLES.md` 后续若增长超过 64 KB，要按画风拆成多份。

### 4.8 AI 婚纱照

**定位**：用户上传双方（及宠物）的人像，选 9 种风格之一，出一组 6–9 张不重复的婚纱照，带导演式分镜。

**上游流程 → 本平台**

| 上游步骤 | 本平台做法 |
| --- | --- |
| 检查是否有双方清晰人像 | 助手看对话里的图；缺就请用户上传，不缺不问 |
| 展示 9 种风格菜单图让用户选 | P2 前：`ask_choices` 列 9 种风格名和一句话描述；P2 后加预览缩略图 |
| 问用哪个模型或平台（ChatGPT、Midjourney、即梦等） | 删除；模型由本平台方案卡决定，`model-adapters.md` 不搬 |
| 收集比例、张数、服装、地点、文化要求 | 有固定选项的用 `ask_choices`，只问缺的 |
| 创意简报、主提示词、6–9 帧分镜表 | 助手先回复简报和分镜表 |
| 多样性检查，重复帧重写 | 写进正文，出方案卡前执行 |
| 先出 1 张代表帧，再出整套，每帧单独请求 | 先 `propose_image_action` 1 张；确认后每帧一个 `items`，`referencedImageIds` 填双方人像 |
| `make_contact_sheet.py` 拼总览图 | 删除；改 `delivery_export` |

**资料**：`styles.md`、`shot-direction.md` 原样复制；风格预览图等 P1。

**人像与隐私**：上游规则保留并写进正文——人像只作身份参考；保留肤色、年龄段、脸型、眼镜等特征；不自动瘦脸、美白、减龄；不承诺完全还原；不识别图中真人身份。人像沿用平台现有的上传与存储规则，技能不额外保存。

## 5. 需要补的平台能力

| 编号 | 能力 | 受益技能 | 说明 |
| --- | --- | --- | --- |
| P1 | 官方技能挂图片资源，并可作为出图参考图 | 手绘 PPT（风格锚点）、内容配图（风格样张）、小黑配图（校准样例）、手绘画风（风格 3.1 锚点）、婚纱照（风格预览） | 现在技能资料只允许 `.md` / `.txt`，`propose_image_action` 的 `referencedImageIds` 只能引用对话里的图。需要：技能图片存储与后台管理；助手可把技能图片加入本轮参考图；计费与参考图数量限制照旧 |
| P2 | `ask_choices` 选项带缩略图 | 内容配图、手绘画风、婚纱照、电商详情图 | 选项增加可选图片地址，前端选项卡显示缩略图；地址只能来自技能自带图片或平台存储 |
| P3 | `files_create` 生成图片版 PPTX（每页一张整图） | 手绘 PPT | 可选。现有 pptx 只有标题加要点 |

P1–P3 都不阻塞首批上线；没有它们时按第 4 节写的退路执行。

## 6. 落地顺序

1. **手绘 PPT**：先用提示词约束代替锚点图上线。
2. **小红书视觉导演**、**小黑配图**、**学术配图**：都不依赖新能力。
3. **电商详情图**：两个上游合并、对齐 `commerce_set_*` 后上线。
4. **手绘画风**（不含 3.1）、**AI 婚纱照**、**内容配图**：先上线文字选项版，P2 完成后换成缩略图选项。
5. **P1**，完成后给手绘 PPT 补锚点图、评估手绘画风 3.1；再做 **P2**、按需做 **P3**。

每个技能的交付物：`apps/server/internal/prompt/skills/<slug>/` 下的 `SKILL.md`、`NOTICE.md`、`references/`（及 `assets/`），以及后台导入后的官方技能记录。

## 7. 验收

每个技能上线前在 AI 助手里用真实素材各跑一遍（按 2026-10-02 起的约定，真实生成不需逐次审批，但控制数量）：

- `@` 后助手按流程提问、按需读资料，不向用户复述正文或资料原文。
- 出图只通过方案卡，用户确认前不扣费。
- 比例、张数、风格锁定与选择一致；中文文字逐字核对。
- 只要文案或审查时（如小红书视觉导演），不出方案卡、不扣费。
- 婚纱照用真实人像测试时，结果不做瘦脸、美白、减龄，回复里不识别人物身份。
- 在文生图入口直接 `@` 时，展开后的正文前半段能单独出可用的图。
- 署名在技能简介中可见，`NOTICE.md` 完整。
