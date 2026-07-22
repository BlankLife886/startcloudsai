# 用户端首页设计规范

更新时间：2026-07-21

适用范围：默认首页 `src/components/themes/DefaultHomeLayout.vue`、`default-home/` 样式与 `features/home-motion/` 动效。工作台、价格、个人中心、认证和画廊各有自己的业务视觉，不强制套用首页展示语言。

## 当前方向：云上美术馆

首页是一条可滚动的线上展览动线，而不是传统 SaaS 营销页。真实公开画廊作品是主要视觉内容，六个创作工作台是行动入口。整体关键词：星云、馆藏、展签、留白、硬边、精确、轻盈。

首屏必须同时表达品牌、可用的创作入口和真实作品。画廊无数据或接口失败时保留完整布局，以 skeleton/错误重试替代空白画布。

## 视觉语言

浅色主题的基础变量：

```css
:root {
  --home-ink: #18203b;
  --home-muted: #79809a;
  --home-violet: #6a4fe0;
  --home-violet-soft: rgba(106, 79, 224, 0.85);
  --home-line: rgba(21, 26, 45, 0.12);
  --home-serif: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  --home-mono: ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace;
}
```

背景使用真实位图 `/brand/home-starcloud-bg-v1.webp`，叠加低对比紫色星云、轨道、光束和颗粒。内容面保持浅灰紫与深墨色文字，紫色只用于路径、进度和重点动作。dark 模式由同一组件样式提供深色展厅变量与图像骨架状态。

首页标题/叙事使用宋体栈，展签、编号、坐标与数据使用 monospace，功能性正文沿用应用无衬线字体。标题不随 viewport 连续缩放；在断点内使用稳定字号或受限 `clamp()`，确保长中文和英文标签不溢出。

## 展厅结构

首页由可配置的 Hall 组成，显隐来自 runtime config 的旧兼容 key：

| Hall | 模块 | 配置 key | 内容 |
| --- | --- | --- | --- |
| 01 | 序厅 | `hero` | 品牌、CTA、馆藏拼贴和作品/创作者/工作台统计 |
| 02 | 创作工坊 | 固定核心区 | 六个工作台入口，配图从公开画廊轮换 |
| 03 | 云端画廊 | `video` | 精选与热门馆藏 |
| 04 | 纵向展墙 | `mobile` | 画廊奇偶切分的一组作品 |
| 05 | 横向展墙 | `desktop` | 与上一展墙错开的作品组 |
| 06 | 随机星尘 | `random` | 按本地随机 seed 洗牌的 12 件作品 |

旧 key 名只为兼容后端页面布局配置，不代表当前模块语义。修改 key 需要同时迁移后台配置和已保存数据。

## 数据规则

- 首页馆藏全部来自 `GET /api/gallery`，不使用假作品占位。
- `useHomeGalleryData.js` 负责列表、统计、分页/补充加载和错误状态。
- 每张图使用 `ShareProgressiveImage.vue`，提供 skeleton、加载完成和失败回退。
- 作品点击进入 `/share?item={id}`；主 CTA 对已登录用户进入文生图，对匿名用户进入认证页。
- 画廊内容不足时允许各区域复用/缩减，不能因数组越界造成空白或布局位移。

## 布局与组件

- 页面 section 最大宽度 1540px，外边距通过断点分级，保留右侧旅程进度的空间。
- 作品图使用明确的 aspect-ratio 和 `object-fit`，内容加载不能改变网格轨道尺寸。
- 视觉卡片采用硬边或小圆角与错位阴影；避免把整个 section 包进悬浮卡片，也避免卡片嵌套。
- 展签包含馆藏编号、作者/日期等真实元数据；无值时隐藏对应字段，不显示伪造内容。
- 按钮和链接必须保持清晰的 hover、active、focus-visible、disabled 状态。

## 动效系统

动效中枢为 `features/home-motion/composables/useHomeMotion.js`：

- GSAP + ScrollTrigger：section reveal、旅程进度、滚动触发和数据到达后的补挂。
- anime.js：局部文字/按钮/随机刷新反馈。
- Three.js：`HomeCelestialCanvas.vue` 的全屏星幕背景。
- Pointer：桌面端星图游标和少量跟随效果。

新画廊数据渲染后必须调用 reveal/trigger 刷新；组件卸载时清理 GSAP context、ScrollTrigger、监听器、RAF 和 Three.js 资源。动效只改变 opacity/transform 等合成属性，不应在滚动中反复触发布局计算。

`prefers-reduced-motion: reduce` 时关闭视差、游标跟随、大幅 transform、连续旋转和非必要自动动画，内容顺序与所有操作保持不变。

## 响应式

- 主要断点与应用保持一致：1200、992、768、576px。
- 桌面多列拼贴在平板/手机逐步降为双列或单列，不依赖横向滚动才能看到核心 CTA。
- 右侧旅程指示和自定义游标在触摸/窄屏隐藏。
- 移动端首屏仍应露出下一段内容，作品媒体使用稳定比例，避免图片解码导致累计布局偏移。
- 触控目标至少 44x44px；任何 viewport 下不得出现文本与作品、顶部导航或固定进度互相遮挡。

## 主题边界

首页可以使用紫色星云和展览叙事；业务工作台应以工具效率为先。认证页使用独立 manga/拼贴语言，个人中心使用独立馆藏档案语言，游戏美术等工作台也可保留领域配色。跨页面只共享应用壳、可访问性、状态反馈与数据语义，不强求一套装饰风格。

## 变更检查

1. 首屏品牌、CTA、真实作品在桌面和移动端可见。
2. loading、空数据、API 错误、图片失败四种状态不出现空白画面。
3. Hall 开关任意组合时 section 编号、旅程进度与间距仍正确。
4. 新数据追加后动效正确挂载，离开首页后无监听器或 WebGL 资源泄漏。
5. reduced-motion、键盘 focus 和触屏操作完整。
6. 运行 `npm run lint`、`npm run build`，并用 Playwright 检查桌面/移动截图与控制台错误。
