# 场景模板与平台套图类型对照

本平台的电商套图工具（commerce_set_plan 的 shots.type）自带一套图类型。整套主图 + 详情页优先走套图工具；下表“套图类型”为空的场景，或用户只要零散的一两张图时，用 propose_image_action 单独出图。

## 25 个场景模板 → 套图类型

| 模板 | 所在文件 | 套图类型（type） |
| --- | --- | --- |
| 01-hero-image 白底/纯色底主图 | templates-product.md | white（产品白底图）、amazon（亚马逊主图） |
| 02-lifestyle-scene 场景生活图 | templates-scene-model.md | scene-hero（场景主图）、scene（产品场景展示图） |
| 03-flat-lay 平铺俯拍 | templates-product.md | — |
| 04-detail-macro 细节微距 | templates-product.md | closeup（细节特写）、craft（细节工艺图） |
| 05-poster-banner 海报横幅 | templates-marketing.md | promo-hero（营销主图海报）、poster（活动海报） |
| 06-social-media 社媒图 | templates-marketing.md | — |
| 07-ugc-style 买家秀 | templates-scene-model.md | ugc（通用买家秀） |
| 08-model-showcase 模特展示 | templates-scene-model.md | model-hero（模特试穿主图）、outfit-single（服装单场景试穿图） |
| 09-before-after 前后对比 | templates-product.md | compare（使用对比图） |
| 10-packaging 包装 | templates-product.md | package（包装展示图） |
| 11-infographic 信息图 | templates-marketing.md | selling（核心卖点图）、selling-hero（卖点主图） |
| 12-creative-concept 创意概念 | templates-marketing.md | — |
| 13-size-spec 尺寸规格 | templates-product.md | spec（规格参数图）、steps（操作步骤演示图） |
| 14-multi-product 套装组合 | templates-scene-model.md | — |
| 15-livestream 直播间 | templates-marketing.md | — |
| 16-try-on-virtual 试穿融入 | templates-scene-model.md | wear（试穿试戴场景）、wear-hero（配饰佩戴主图） |
| 17-exploded-view 拆解爆炸图 | templates-product.md | design（产品设计图）、principle（功能原理解析图） |
| 18-ghost-mannequin 隐形模特 | templates-product.md | — |
| 19-multi-angle-grid 多角度 | templates-product.md | angles（产品多角度） |
| 20-magazine-editorial 杂志大片 | templates-brand.md | — |
| 21-seasonal-campaign 季节活动 | templates-marketing.md | sale-hero（大促营销主图） |
| 22-luxury-atmospherics 奢华氛围 | templates-brand.md | —（可用套图风格“高级质感风”） |
| 23-device-mockup 设备界面 | templates-brand.md | — |
| 24-storefront 店铺空间 | templates-brand.md | — |
| 25-sports-campaign 运动活动 | templates-marketing.md | — |

## 8 种标准套图类型（image-types.md）→ 套图类型

| image-types.md | 套图类型（type） |
| --- | --- |
| 图1 白底主图 | white |
| 图2 核心卖点图 | selling-hero、selling |
| 图3 卖点图 | selling |
| 图4 材质图 | material（成分材质解析图）、craft |
| 图5 场景展示图 | scene |
| 图6 模特展示图 | model-hero、outfit-single |
| 图7 多场景拼图 | multiscene（多场景展示图） |
| 图8 电商详情图 | hero（首屏视觉图）加 selling / spec 等详情类型 |
| 自动补充 三角度拼图 | angles |

## 平台与风格

- platform 参数可直接填：淘宝、天猫、京东、拼多多、抖音电商、小红书、亚马逊、Shopify、独立站 等（与 platforms.md 中的平台对应）。
- style 参数可选：简约清新风、高级质感风、活泼吸睛风、复古怀旧风、场景写实风、科技未来风、国风古韵风。Campaign Style Lock 里定下的色调、光线、背景写进 note。
- 主图默认 1:1，详情页默认 3:4（上游建议详情页 2:3，用户要求时用 detailRatio 改）。
