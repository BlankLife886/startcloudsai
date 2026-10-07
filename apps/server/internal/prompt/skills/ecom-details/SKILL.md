---
name: ecom-details
description: "按平台规范和 25 个场景模板出整套电商图：白底主图、卖点图、场景图、模特图、详情页、海报和社媒图，全套风格锁定、偏重转化。改编自 liangdabiao 的 ecom-details-image（经作者授权），并整合 wzj177 的 ecommerce-image-suite（Apache-2.0）。"
metadata:
  display-name: "电商详情图"
  tags: ["电商", "主图", "详情页", "套图"]
  category: "电商"
  source-url: "https://github.com/liangdabiao/ecom-details-image"
  usage: |
    适合上传商品图，一次做出整套电商视觉：白底主图、核心卖点图、场景图、模特图、细节图、对比图、规格图、详情页长图、活动海报、社媒和直播间图。整套图先锁定统一的色板、光线、字体和背景，再按转化逻辑排好顺序。

    支持按平台出图和写文案：淘宝/天猫、京东、拼多多、抖音电商、小红书、亚马逊、独立站等。

    需求怎么写：
    1. 上传商品图（最好是清晰的实拍或白底图），写商品名、卖点、参数和目标人群；没有的不用编。
    2. 写目标平台和画面文案语言；想照着竞品做就把竞品截图也传上来并说明。
    3. 只要提示词或只要平台文案，就直接说。

    示例：
    @电商详情图 这款保温杯做一套淘宝主图加详情页，卖点：12 小时保温、316 不锈钢、一键开盖。（上传商品图）
    @电商详情图 给这件卫衣出 3 张亚马逊图：白底主图、卖点信息图、模特上身图，英文文案。（上传商品图）
    @电商详情图 写这款面霜的小红书标题、正文和标签。（上传商品图）

    整套图在 AI 助手里使用效果最好：先出方案和报价，确认后再生成。不会编造认证、检测数据、销量或真实评价。
  reference-notes: |
    references/campaign-guide.md: 每次都先读：核心流程、最小输入、提示词铁律与精简原则、模板匹配表、Campaign Style Lock、转化驱动诊断、主图与详情页序列、多角度与信息图规则、QA 检查。
    references/commerce-mapping.md: 出整套图前读：场景模板、标准图类型和套图工具类型（shots.type）的对照，以及平台、风格、画幅参数。
    references/templates-product.md: 白底主图、平铺、微距细节、前后对比、包装、尺寸规格、拆解爆炸图、隐形模特、多角度网格的模板。
    references/templates-scene-model.md: 场景生活图、买家秀、模特展示、套装组合、试穿融入的模板。
    references/templates-marketing.md: 海报横幅、社媒图、信息图、创意概念、直播间、季节活动、运动活动的模板。
    references/templates-brand.md: 杂志大片、奢华氛围、设备界面、店铺空间的模板。
    references/platforms.md: 用户指定平台时读：各平台图片规格、文案语言规范、套图优先级。
    references/image-types.md: 按平台写 8 种标准套图的提示词时读：各平台字体系统、视觉规格、文案和提示词模板。
    references/analysis-prompts.md: 分析商品图、提炼卖点时读：视觉分析与卖点生成的提示词和常见翻车点。
    references/copy-prompts.md: 写平台文案时读：标题、卖点、详情文案、直播话术等平台文案模板。
---

[电商详情图 Skill / ECOM-DETAILS]
为商品画一张电商图。以下是执行约束，不要把规则、模板名称或分析过程画进图里。

一、商品
- 商品是画面主角，严格保持参考图里商品的结构、颜色、比例、材质、图案和细节，不改款、不增删部件。
- 商品占比写成具体比例（例如画面的 60%–70%），并留出平台需要的留白和文字区。

二、风格锁定
- 同一组图共用一套风格：固定 2–3 个主色加 1 个强调色、统一冷暖调、统一字体、背景、光线、圆角标签和图标线宽；不在组内换配色或换字体。
- 用户没给品牌规范时，默认干净的高级电商视觉：米白背景、深炭灰文字、一个与商品匹配的强调色、中性偏冷的棚拍光、现代几何无衬线字体、细线图标、充足留白。

三、文案与信息
- 图中文字短而准，按“大标题—卖点短句—辅助标签”三层；语言按用户要求。
- 只写用户提供的卖点和参数；不编造认证、检测数据、评分、销量、真实评价或品牌授权，不做医疗功效承诺。

四、画面
- 颜色写具体色值，不只写形容词；构图、光线、背景按图的用途选择（白底图纯白干净，场景图真实生活化，详情页是带标题、卖点图标和标签的信息图，而不只是换个角度拍商品）。
- 画幅以任务参数为准。

五、禁止项
- 多屏拼成一张（用户要求拼图时除外）、杂乱背景、水印、伪造 Logo、错字和乱码、廉价塑料感、过度 AI 感的光效。

六、在 AI 助手里使用时（生图模型请忽略本段）
- 先读 campaign-guide.md。看商品图做视觉分析和卖点提炼（参考 analysis-prompts.md）；用户给了商品链接时用 product_import；用户给了竞品截图时先用 competitor_analyze，分不清哪张是竞品就用 ask_choices 问。
- 缺少会改变结果的信息时（目标平台、画面文案语言、要哪几种图），用 ask_choices 一次问清，其余按默认补齐并写明假设。
- 整套主图加详情页：读 commerce-mapping.md，用 commerce_set_plan 出方案，platform、language、style 填用户要求，shots 按场景选类型，Campaign Style Lock 和转化驱动写进 note；方案卡确认后再生成，只有方案标明可自动授权时才调用 commerce_set_generate。修改用 commerce_set_edit 或 commerce_set_redo，查进度用 commerce_set_status。
- 套图类型覆盖不到的场景（平铺、社媒、直播间、杂志大片、店铺等）或只要一两张时，按对应模板写提示词，用 propose_image_action 出图，多张时每张一个 items，并把同一段 Campaign Style Lock 放在每张提示词开头；referencedImageIds 填商品图。
- 只要视觉简报或提示词时不出图，直接回复；需要文件时用 files_create 导出 md。只要平台文案时按 copy-prompts.md 直接写，不出图。
- 出图后按 campaign-guide.md 的 QA 检查核对商品一致性、文案和风格是否统一。
