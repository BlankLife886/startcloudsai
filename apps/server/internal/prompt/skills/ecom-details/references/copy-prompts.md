# 电商文案 & 详情页 Prompt 模板

## 通用说明

按以下模板生成平台文案（上游的详情页 HTML 部分本平台不使用，已删去）。
将 `{product_json}` 替换为第二步生成的商品卖点 JSON，`{images_list}` 替换为已生成的套图列表。

---

## 一、平台文案 Prompt

### 系统 Prompt（所有平台通用）

```
你是一位专业电商文案策划师和转化率专家，精通各大平台规则。
严格按照指定平台要求输出文案，直接给出最终内容，不要任何说明、markdown或代码块。
```

---

### 淘宝/天猫 文案 Prompt

```
平台：淘宝/天猫
商品信息：{product_json}

请生成以下内容，严格按区块标注输出：

【标题】
- 主标题（≤30字，含核心关键词，格式：品牌/品类词+核心卖点+属性词）
- 副标题（≤25字，补充卖点或活动信息）

【核心卖点】
5条 bullet，每条格式：「关键词｜说明文字」，≤20字/条
侧重：情感价值 > 功能参数，强调"感受"而非"规格"

【详细描述】（400-550字）
结构：痛点共鸣 → 三大亮点 → 场景代入 → 促单背书

【搜索关键词】
20个，逗号分隔，含长尾词，覆盖：品类词+属性词+场景词+人群词

【类目属性标签】
10个，用于店铺标签和类目筛选
```

---

### 京东 文案 Prompt

```
平台：京东
商品信息：{product_json}

请生成以下内容，严格按区块标注输出：

【商品标题】
≤60字，格式：品牌+商品名+核心参数/材质+适用场景
突出品质背书，避免促销词，多用参数描述

【商品卖点（5条）】
每条 ≤15字，格式：「参数/材质名称：具体说明」
侧重：材质参数 > 情感表达，数据化、可验证

【商品描述】（400-600字，结构：定位 → 参数详解 → 工艺说明 → 售后背书）

【搜索关键词】
15个，偏向参数词和品类精准词，逗号分隔

【京东类目标签】
8个
```

---

### 拼多多 文案 Prompt

```
平台：拼多多
商品信息：{product_json}

请生成以下内容，严格按区块标注输出：

【商品标题】
≤30字，格式：核心品类词+最强卖点+价格锚点词（"超值""划算"等）
直白，不堆砌，第一眼看清是什么

【核心卖点（3条）】
极简风格，每条 ≤10字，直击利益点
如：「厂价直发，省中间商差价」「买2件减10元」

【商品描述】（150-200字）

【搜索关键词】
10个，精准品类词为主，逗号分隔
```

---

### 抖音电商 文案 Prompt

```
平台：抖音电商（抖店）
商品信息：{product_json}

请生成以下内容，严格按区块标注输出：

【视频标题/封面文案】
≤20字，口语化，情绪触发，适合短视频封面展示
格式参考：「这件T恤穿上真的瘦10斤！」「女朋友看到直接下单」

【商品标题（店铺展示用）】
≤20字，品类词+场景词+吸引点

【直播话术脚本】（3段，每段≤80字）

【商品描述（详情页）】
200-300字，口语化，场景代入感强，多用"你""我"第一人称

【话题标签】
8个，格式：#标签名，覆盖：品类标签+场景标签+人群标签+热门话题
```

---

### Amazon 文案 Prompt

```
Platform: Amazon
Market: {market}（US / UK / DE / JP / etc.）
Product Info: {product_json}

Generate the following, labeled by section:

[TITLE]
≤200 characters. Format: Brand + Main Keyword + Key Feature + Variant Info
Follow Amazon title policy: no promotional phrases ("best", "sale"), no all-caps
Capitalize first letter of each major word

[BULLET POINTS] (5 bullets)
Each bullet ≤255 characters. Start with a capitalized feature keyword followed by em dash.
Format: "FEATURE KEYWORD — Benefit-focused explanation with specific details"
Order: Most important benefit first. Cover: material, fit/size, function, care, compatibility/occasion

[PRODUCT DESCRIPTION]
150-300 words. Plain text, no HTML.
Structure: Hook sentence → 3 key benefits expanded → Use cases → Call to action
Use natural language optimized for A9 search algorithm.

[BACKEND SEARCH TERMS]
Total ≤250 bytes. Space-separated, no commas, no repetition of title words.
Include: synonyms, alternate spellings, related terms, Spanish terms (for US market)

[TAGS / BROWSE NODE KEYWORDS]
10 terms for Amazon browse node classification
```

---

### 独立站 / Shopify 文案 Prompt

```
Platform: Shopify / Independent Website
Language: {language}（EN / ZH / etc.）
Brand Tone: {brand_tone}（minimalist / playful / luxury / streetwear）
Product Info: {product_json}

Generate the following, labeled by section:

[SEO TITLE TAG]
≤60 characters. Format: Primary Keyword | Brand Name
Include target keyword naturally, no keyword stuffing

[META DESCRIPTION]
≤160 characters. Compelling, includes CTA ("Shop now", "Free shipping").
Contains primary keyword once naturally.

[PRODUCT PAGE H1]
≤70 characters. Brand voice, not just keyword. Memorable.

[PRODUCT DESCRIPTION - SHORT]
50-80 words. Used above the fold. Hook + top 2 benefits + CTA.
Scannable, emotional, brand voice consistent.

[PRODUCT DESCRIPTION - LONG]
200-350 words. Full storytelling version.
Structure: Story/problem → Product solution → Key features (3) → Social proof hint → Sizing/fit guide → CTA

[FEATURE BULLETS]
5 items, each 10-15 words. Benefit-first format.

[FAQ SECTION]
3 Q&A pairs covering: sizing, material/care, shipping
```

---

## 三、平台选择影响矩阵

Agent 在生成前应按此矩阵确认平台，不做跨平台兼容：

| 平台 | 文案语言 | 文案风格 | 详情页类型 | 美学定位 | 特殊处理 |
|------|---------|---------|-----------|---------|---------|
| 淘宝/天猫 | 中文 | 情感化 | 手机端HTML | 内容杂志风 | 需促销话术，衬线字体 |
| 京东 | 中文 | 参数化 | 手机端HTML | 技术规格美学 | 需品质背书，等宽字体 |
| 拼多多 | 中文 | 极简价格导向 | 手机端HTML | POP艺术冲击 | 字数最少，高饱和度 |
| 抖音 | 中文 | 口语+直播话术 | 手机端HTML | Neo-Brutalist | 额外生成直播话术，故障风 |
| Amazon | 英文（按市场） | A9关键词优化 | A+ Content HTML | 高端目录风格 | Search Terms字段 |
| 独立站 | 按语言参数 | 品牌叙事 | 完整SEO HTML | DTC品牌美学 | Schema.org + OG |
