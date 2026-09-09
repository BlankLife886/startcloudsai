# 项目图标存储、指向与使用清单

更新时间：2026-09-01

本文档清点当前仓库中的全部图标来源，说明图标存放在哪里、由什么图标库提供、重要图标点击后前往哪里或执行什么操作。统计范围包括 React 用户端、Vue 管理后台、无限画布、Flutter 移动端、品牌/模型 SVG、旧版 PNG 操作图标和移动端应用图标。

> 这里的“指向”分为两类：导航图标指向路由；操作图标不指向页面，而是触发所在组件传入的回调，例如删除、下载、重试、裁剪。纯状态图标和装饰图形没有点击指向。

## 一、总览

| 区域 | 图标来源 | 当前版本 | 实际引用种类 | 源码/资源位置 | 构建后的形态 |
|---|---|---:|---:|---|---|
| React 用户端旧版及业务页面 | Bootstrap Icons | `1.13.1` | 320 | `apps/web-react/src/**` 中的 `bi-*` 类名；包在 `apps/web-react/node_modules/bootstrap-icons/` | 字体和 CSS 打包到 `apps/web-react/dist/assets/` |
| React 无限画布及新页面 | Lucide React | `^1.16.0` | 134 | `apps/web-react/src/**` 中从 `lucide-react` 导入 | SVG React 组件进入对应 JS chunk |
| Vue 管理后台 | Element Plus Icons | `^2.3.1` | 63 | `apps/admin/src/**` 中从 `@element-plus/icons-vue` 导入 | SVG Vue 组件进入 `apps/admin/dist/assets/` |
| Flutter 移动端 | Material Icons | Flutter SDK | 223 | `apps/mobile/lib/**` 中的 `Icons.*` | 随 APK/IPA 字体资源打包 |
| React 依赖但未使用 | Ant Design Icons | `^6.1.1` | 0 | 只存在于 `apps/web-react/package.json`，源码无导入 | 当前没有图标进入业务包 |
| 模型/服务商品牌图标 | 自有 SVG 文件 | - | 10 | `apps/web-react/public/icons/` | 原路径复制到 `dist/icons/`，访问 URL 为 `/icons/...` |
| 产品品牌资源 | 自有 SVG/PNG | - | 4 | `apps/web-react/public/brand/`、`apps/web-react/public/logo.svg` | 原路径复制到 `dist/brand/` 或 `dist/logo.svg` |
| 旧版操作图标 | PNG 遮罩 | - | 6 | `apps/web-react/src/legacy-static/assets/icons/` | 由 Vite 生成带哈希的资源文件 |
| Android/iOS 应用图标 | PNG/Asset Catalog | - | 多尺寸 | `apps/mobile/android/.../mipmap-*`、`apps/mobile/ios/.../AppIcon.appiconset` | 进入 Android/iOS 安装包 |

Bootstrap Icons 的全局入口是 `apps/web-react/src/main.jsx` 中的 `bootstrap-icons/font/bootstrap-icons.css`。Lucide 和 Element Plus 图标按组件导入，不存在一个统一的本地图标文件夹。Flutter 在 `apps/mobile/pubspec.yaml` 中启用了 `uses-material-design: true`。

## 二、React 用户端导航图标

主导航的唯一配置源是 `apps/web-react/src/layout/NavBar.jsx`。

### 2.1 一级导航

| 图标 | 显示名称 | 指向/行为 |
|---|---|---|
| `bi-house-door-fill` | 首页 | `/` |
| `bi-grid-1x2-fill` | 创作台 | `/studio` |
| `bi-bounding-box-circles` | 无限画布 | `/canvas` |
| `bi-collection` | 我的资产 | `/assets` |
| `bi-bag-check-fill` | AI 电商 | 展开 AI 电商菜单 |
| `bi-palette-fill` | 图片设计 | 展开图片设计菜单 |
| `bi-journal-richtext` | 提示词 | `/prompts` |
| `bi-images` | 社区 | `/share` |
| `bi-clock-history` | 历史记录 | `/history`，需要登录 |
| `bi-credit-card-2-front-fill` | 创作价格 | `/pricing` |
| `bi-gift` | 创作激励 | `/incentive-plans` |
| `bi-columns-gap` | 工具 | 展开工具菜单 |

导航是否显示还会经过后台页面控制配置过滤，因此代码中有图标不代表线上一定可见。

### 2.2 图片设计菜单

| 图标 | 功能 | 指向 |
|---|---|---|
| `bi-chat-square-text-fill` | AI 助手 | `/assistant` |
| `bi-stars` | 文生图 | `/text-to-image` |
| `bi-person-bounding-box` | 模型设计 | `/model-sheet` |
| `bi-brush-fill` | 插画染色 | `/ai-illustration-coloring` |
| `bi-bezier2` | UI 设计稿 | `/design-workshop` |
| `bi-controller` | 游戏设计 | `/game-art` |

### 2.3 AI 电商菜单

所有电商入口都指向 `/ecommerce-design?tool=<工具 ID>`。

| 图标 | 工具 ID | 功能 |
|---|---|---|
| `bi-person-standing-dress` | `tryon` | AI 虚拟试衣 |
| `bi-hand-index-thumb-fill` | `handheld` | 手持商品图 |
| `bi-gem` | `accessory` | AI 饰品穿戴 |
| `bi-camera-fill` | `shoot` | AI 创意商拍 |
| `bi-images` | `listing` | 商品套图 |
| `bi-layout-text-window-reverse` | `detail` | A+ / 详情页 |
| `bi-megaphone-fill` | `campaign` | AI 营销图 |
| `bi-card-image` | `background` | AI 背景图 |
| `bi-layers-fill` | `backdrop` | 背景复刻 |
| `bi-circle-half` | `shadow` | AI 商品阴影 |
| `bi-arrows-angle-expand` | `outpaint` | 智能扩图 |
| `bi-badge-hd-fill` | `enhance` | 真实增强 |

### 2.4 工具菜单

| 图标 | 功能 | 指向 |
|---|---|---|
| `bi-person-bounding-box` | 背景移除 | `/tools/background-remove` |
| `bi-file-zip` | 图片压缩 | `/tools/image-compress` |
| `bi-puzzle-fill` | 拼图 | `/tools/puzzle` |
| `bi-columns-gap` | 关于我们 | `/app-space` |
| `bi-journal-text` | 更新说明 | `/updates` |
| `bi-chat-square-text` | 问题反馈 | `/feedback` |
| `bi-camera-video` | 后台配置的视频工具 | `/tools/<工具 ID>` |
| `bi-soundwave` | 后台配置的音频工具 | `/tools/<工具 ID>` |
| `bi-image` | 后台配置的图片工具 | `/tools/<工具 ID>` |

## 三、管理后台导航图标

后台侧边栏的唯一配置源是 `apps/admin/src/AdminLayout.vue`。

| Element Plus 图标 | 后台功能 | 指向 |
|---|---|---|
| `Odometer` | 仪表盘 | `/` |
| `Setting` | 系统设置 | `/settings` |
| `User` | 用户管理 | `/users` |
| `Monitor` | 任务与调度 | `/tasks` |
| `MagicStick` | 模型配置 | `/model-config` |
| `DataAnalysis` | Agent 质量 | `/agent-quality` |
| `Files` | 画布模板 | `/canvas-templates` |
| `Operation` | 页面控制 | `/page-controls` |
| `Document` | 内容管理 | `/content` |
| `CollectionTag` | 提示词库 | `/prompt-library` |
| `ShoppingBag` | 电商素材 | `/ecommerce` |
| `ChatDotRound` | 社区管理 | `/community` |
| `Picture` | 投稿审核 | `/gallery` |
| `ChatDotRound` | 用户反馈 | `/feedback` |
| `Star` | 体验活动 | `/trial-applications` |
| `Calendar` | 签到活动 | `/checkin-activity` |
| `UserFilled` | 好友拼团 | `/growth-groups` |
| `TrendCharts` | 成本利润 | `/profitability` |
| `Box` | 套餐管理 | `/plans` |
| `Ticket` | 兑换码 | `/codes` |
| `List` | 审计日志 | `/audit` |
| `Monitor` | 运行日志 | `/platform-logs` |
| `Lock` | 安全中心 | `/security-center` |

后台顶栏和通知区还使用：`Bell` 打开待办通知，`Fold`/`Expand` 收起或展开侧栏，`Sunny`/`Moon` 切换主题，`SwitchButton` 退出登录；它们触发本地动作，不跳转固定路由。

## 四、无限画布图标与操作

无限画布主要使用 Lucide。图标本身不是图片文件，而是从 `lucide-react` 导入的 SVG 组件。

### 4.1 顶部工具条

配置文件：`apps/web-react/src/canvas/components/canvas/canvas-toolbar.tsx`。

| Lucide 图标 | 操作 |
|---|---|
| `Home` | 返回画布项目列表 |
| `Plus` | 新建项目 |
| `MousePointer2` / `Hand` | 在选择模式和拖动画布模式之间切换 |
| `Type` | 新建文本节点 |
| `ImageIcon` | 新建/上传图片节点 |
| `Video` | 新建视频节点；未启用时禁用 |
| `Music2` | 新建音频节点；未启用时禁用 |
| `Settings2` | 新建配置节点 |
| `Group` | 新建分组节点 |
| `Puzzle` | 打开扩展节点菜单 |
| `Undo2` | 撤销 |
| `Redo2` | 重做 |
| `Trash2` | 删除当前选中节点 |

操作节点的图标由节点注册表动态提供，来源在 `apps/web-react/src/canvas/lib/canvas/node-registry` 相关文件；插件节点可以增加自己的图标，因此不能只靠工具条文件列死。

### 4.2 图片节点快捷工具

配置文件：`apps/web-react/src/canvas/components/canvas/canvas-image-toolbar-tools.tsx`。

| Lucide 图标 | 操作 ID | 操作 |
|---|---|---|
| `Copy` | `copyPrompt` | 复制提示词 |
| `FileText` | `reversePrompt` | 图片反推提示词 |
| `Upload` | `replace` | 替换图片 |
| `Lock` / `LockOpen` | `resize` | 锁定比例/自由缩放 |
| `Brush` | `maskEdit` | 蒙版编辑 |
| `Scissors` | `crop` | 裁剪 |
| `Grid2x2` | `split` | 切图 |
| `ZoomIn` | `upscale` | 放大/超分 |
| `Eraser` | `removeBackground` | 移除背景 |
| `Camera` | `angle` | 调整视角 |
| `Maximize2` | `view` | 打开大图查看 |

基础快捷项 `info`、`delete`、`saveAsset`、`download`、`edit` 的显示和处理由图片节点及上下文菜单组合完成。常见图标分别是 `Info`、`Trash2`、`FolderPlus`、`Download`、`Pencil`。

### 4.3 节点和画布通用操作

| 常见图标 | 触发动作 |
|---|---|
| `Pencil` / `PenLine` | 重命名或编辑文字 |
| `RefreshCw` / `RotateCcw` | 重试、刷新或恢复 |
| `FolderPlus` | 保存到资产库 |
| `Download` | 下载结果 |
| `MessageSquare` / `Settings2` | 打开节点提示词或配置面板 |
| `Ellipsis` | 打开更多操作下拉菜单 |
| `Link2` | 连接、复制链接或查看关联关系，具体取决于所在组件 |
| `Play` | 运行工作流或执行节点 |
| `X` / `XCircle` | 关闭、取消或清除 |
| `Trash2` | 删除节点、连接线或选中内容 |
| `ZoomIn` / `ZoomOut` | 缩放画布或图片 |

相同图标可以在不同组件触发不同回调。准确行为以图标所在组件的 `onClick` 为准，不应仅凭图标名称推断。

## 五、移动端导航图标

移动端路由定义在 `apps/mobile/lib/app/app_router.dart`，底部导航定义在 `apps/mobile/lib/features/shell/app_shell.dart`。

### 5.1 底部导航

| Material 图标 | 选中图标 | 页面 | 指向 |
|---|---|---|---|
| `home_outlined` | `home_rounded` | 首页 | `/discover` |
| `auto_awesome_outlined` | `auto_awesome_rounded` | AI | `/ai` |
| `palette_outlined` | `palette_rounded` | 设计 | `/design` |
| `person_outline_rounded` | `person_rounded` | 我的 | `/profile` |

### 5.2 带固定图标的二级页面

| Material 图标 | 页面 | 指向 |
|---|---|---|
| `public_outlined` | 我的投稿 | `/profile/submissions` |
| `notifications_outlined` | 通知中心 | `/profile/notifications` |
| `calendar_month_outlined` | 每日签到 | `/profile/checkin` |
| `account_balance_wallet_outlined` | 积分钱包 | `/profile/wallet` |
| `receipt_long_outlined` | 积分明细 | `/profile/wallet/ledger` |
| `shopping_bag_outlined` | 套餐与订单 | `/profile/purchases` |
| `receipt_long_outlined` | 我的订单 | `/profile/purchases/orders` |
| `card_giftcard_outlined` | 福利中心 | `/profile/benefits` |
| `auto_awesome_outlined` | 体验资格 | `/profile/benefits/trial` |
| `trending_up` | 成长奖励 | `/profile/benefits/growth` |
| `groups_outlined` | 好友拼团 | `/profile/benefits/group` |
| `collections_outlined` | 我的素材 | `/profile/assets` |
| `feedback_outlined` | 问题反馈 | `/profile/feedback` |
| `manage_accounts_outlined` | 编辑资料 | `/profile/edit` |
| `auto_awesome_outlined` | AI 助手独立入口 | `/assistant` |
| `photo_outlined` | 作品详情 | `/works/:id` |

其余 Material 图标多用于按钮、状态、表单和空状态，不具有固定全局路由。

## 六、真实图标文件

### 6.1 模型和服务商 SVG

目录：`apps/web-react/public/icons/`。线上访问路径保持 `/icons/<文件名>`。

| 文件 | 表示对象 | 当前使用位置 |
|---|---|---|
| `bytedance.svg` | 字节/火山相关模型 | 创作价格页 |
| `claude.svg` | Claude/Anthropic | 画布模型选择、配置节点、提示词节点 |
| `deepseek.svg` | DeepSeek | 画布模型选择、配置节点、提示词节点 |
| `gemini.svg` | Gemini/Google | 画布模型选择、配置节点、提示词节点、创作价格页 |
| `glm.svg` | GLM/智谱 | 画布模型选择、配置节点、提示词节点 |
| `grok.svg` | Grok | 画布模型选择、配置节点、提示词节点 |
| `kling.svg` | 可灵 | 创作价格页 |
| `linuxdo.svg` | Linux DO | 当前源码未引用，属于预留/遗留资源 |
| `nano-banana.svg` | Nano Banana | 创作价格页 |
| `openai.svg` | OpenAI/GPT | 画布模型选择、配置节点、提示词节点、创作价格页 |

`LICENSE.lobe-icons.txt` 是上述部分品牌图标的许可证说明，不是图标。`.DS_Store` 是 macOS 目录元数据，不是图标，也不应进入正式资源包。

### 6.2 产品品牌资源

| 文件 | 用途 | 当前使用位置 |
|---|---|---|
| `apps/web-react/public/brand/starcloud-logo.svg` | StarCloud 品牌 Logo | 顶部导航、登录/账号页、迁移预览页 |
| `apps/web-react/public/brand/avatar-placeholder.svg` | 默认头像 | 顶部账号区、账号设置、签到页 |
| `apps/web-react/public/brand/auth-manga-bg.png` | 登录页背景图 | 认证页面视觉背景；不是操作图标 |
| `apps/web-react/public/logo.svg` | 旧/预留 Logo | 当前源码没有引用 |

### 6.3 旧版 PNG 操作图标

目录：`apps/web-react/src/legacy-static/assets/icons/`。这些文件通过 CSS `mask-image` 着色，不按原 PNG 颜色直接显示。

| 文件 | 含义 | 使用位置 |
|---|---|---|
| `delete.png` | 删除 | 文生图旧版历史操作、用户历史页 |
| `download.png` | 下载 | 文生图旧版历史操作、用户历史页 |
| `edit-image.png` | 编辑图片 | 文生图旧版历史操作 |
| `publish.png` | 发布/投稿 | 文生图旧版历史操作、用户历史页 |
| `reference.png` | 设为参考图 | 文生图旧版历史操作 |
| `regenerate.png` | 重新生成 | 文生图旧版历史操作 |

### 6.4 移动端应用图标

Android 启动图标按像素密度存储：

- `apps/mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher.png`
- `apps/mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher.png`
- `apps/mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png`
- `apps/mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png`
- `apps/mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`

iOS 应用图标位于 `apps/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/`，由 `Contents.json` 对应 20、29、40、60、76、83.5 和 1024 像素规格。启动图片位于 `apps/mobile/ios/Runner/Assets.xcassets/LaunchImage.imageset/`。这些图片只用于系统桌面和启动阶段，不参与应用内部按钮显示。

## 七、自绘 SVG 和程序绘制图形

下面这些不是统一图标库资源，修改时必须直接查看对应组件：

### 7.1 React/Vue 内联 SVG

- `apps/web-react/src/views/AssistantWorkspaceView.jsx`：助手工作区内的自绘图形。
- `apps/web-react/src/layout/ThemeSwitch.jsx`：主题切换图形。
- `apps/web-react/src/layout/NavBar.jsx`：部分导航/品牌辅助图形。
- `apps/web-react/src/canvas/components/canvas/canvas-top-bar.tsx`：画布顶栏图形。
- `apps/web-react/src/canvas/components/canvas/canvas-project-card.tsx`：画布项目卡片图形。
- `apps/web-react/src/canvas/components/canvas/nodes/bundled/svg-node.tsx`：SVG 节点内容，本身属于用户画布内容，不一定是 UI 图标。
- `apps/web-react/src/canvas/pages/canvas/project.tsx`：画布交互辅助图形。
- `apps/web-react/src/views/ProfileView.jsx`：个人页自绘图形。
- `apps/admin/src/views/GalleryView.vue`：后台图库相关自绘图形。

### 7.2 Flutter `CustomPainter`

- `_HomeSidebarIconPainter`：`apps/mobile/lib/features/shell/app_shell.dart`，首页侧栏图形。
- `_RefreshArcPainter`：`apps/mobile/lib/core/widgets/app_refresh.dart`，下拉刷新弧线。
- `_CheckerboardPainter`：`apps/mobile/lib/features/background_remove/background_remove_screen.dart`，透明棋盘背景。
- `_CinemaParticleGradientPainter`：`apps/mobile/lib/features/create/create_screen.dart`，创建页装饰粒子。
- `_BlueprintPainter`：`apps/mobile/lib/features/model_sheet/model_sheet_screen.dart`，模型设计蓝图背景。

这些项目中既有功能图标，也有背景、进度和装饰图形；后四类不能当作导航图标理解。

## 八、完整图标名称索引

以下索引按当前源码静态扫描生成。名称存在于索引中，只代表代码有引用；受权限、页面开关、条件渲染和运行状态影响，不保证每个图标都会同时显示。

### 8.1 Bootstrap Icons（320）

- `bi-align-bottom`, `bi-alipay`, `bi-android2`, `bi-app-indicator`, `bi-apple`, `bi-archive`, `bi-arrow-bar-down`, `bi-arrow-clockwise`, `bi-arrow-counterclockwise`, `bi-arrow-down`, `bi-arrow-left`, `bi-arrow-left-right`, `bi-arrow-repeat`, `bi-arrow-right`, `bi-arrow-up`, `bi-arrow-up-right`
- `bi-arrows-angle-contract`, `bi-arrows-angle-expand`, `bi-arrows-collapse`, `bi-arrows-fullscreen`, `bi-arrows-move`, `bi-aspect-ratio`, `bi-award-fill`, `bi-backpack`, `bi-badge-3d`, `bi-badge-4k`, `bi-badge-8k`, `bi-badge-hd`, `bi-badge-hd-fill`, `bi-badge-sd`, `bi-bag`, `bi-bag-check`
- `bi-bag-check-fill`, `bi-bag-plus`, `bi-bandaid`, `bi-bar-chart`, `bi-bar-chart-fill`, `bi-battery-full`, `bi-bell`, `bi-bell-slash`, `bi-bezier2`, `bi-book`, `bi-bookmark`, `bi-bookmark-check`, `bi-bookmark-star`, `bi-bounding-box`, `bi-bounding-box-circles`, `bi-box`
- `bi-box-arrow-in-right`, `bi-box-arrow-right`, `bi-box-arrow-up-right`, `bi-box-seam`, `bi-box2-heart`, `bi-boxes`, `bi-braces`, `bi-brightness-high`, `bi-broadcast`, `bi-brush`, `bi-brush-fill`, `bi-bug`, `bi-buildings`, `bi-calendar-check`, `bi-calendar2-check`, `bi-calendar2-x`
- `bi-calendar3`, `bi-camera`, `bi-camera-fill`, `bi-camera-reels`, `bi-camera-video`, `bi-card-image`, `bi-card-text`, `bi-chat-dots`, `bi-chat-dots-fill`, `bi-chat-left-dots`, `bi-chat-square-text`, `bi-chat-square-text-fill`, `bi-check`, `bi-check-circle`, `bi-check-circle-fill`, `bi-check-lg`
- `bi-check-square-fill`, `bi-check2`, `bi-check2-all`, `bi-check2-circle`, `bi-chevron-double-right`, `bi-chevron-down`, `bi-chevron-left`, `bi-chevron-right`, `bi-chevron-up`, `bi-circle`, `bi-circle-fill`, `bi-circle-half`, `bi-clipboard-check`, `bi-clock`, `bi-clock-history`, `bi-cloud-arrow-up`
- `bi-cloud-slash`, `bi-code-square`, `bi-coin`, `bi-collection`, `bi-columns-gap`, `bi-compass`, `bi-controller`, `bi-copy`, `bi-cpu`, `bi-credit-card-2-front-fill`, `bi-cup-hot`, `bi-cursor-fill`, `bi-dash`, `bi-dash-circle`, `bi-dash-lg`, `bi-diagram-3`
- `bi-display`, `bi-distribute-vertical`, `bi-dot`, `bi-download`, `bi-droplet`, `bi-earbuds`, `bi-easel2`, `bi-emoji-smile`, `bi-envelope`, `bi-eraser`, `bi-exclamation-circle`, `bi-exclamation-lg`, `bi-exclamation-octagon`, `bi-exclamation-triangle`, `bi-exclamation-triangle-fill`, `bi-eye`
- `bi-eyeglasses`, `bi-feather`, `bi-file-earmark-arrow-down`, `bi-file-earmark-image`, `bi-file-earmark-pdf`, `bi-file-earmark-slides`, `bi-file-earmark-spreadsheet`, `bi-file-earmark-text`, `bi-file-earmark-word`, `bi-file-earmark-zip`, `bi-file-image`, `bi-file-zip`, `bi-filetype-jpg`, `bi-filetype-md`, `bi-filetype-png`, `bi-filter`
- `bi-flower1`, `bi-folder-fill`, `bi-folder-plus`, `bi-folder-x`, `bi-folder2-open`, `bi-fonts`, `bi-fullscreen`, `bi-fullscreen-exit`, `bi-gear`, `bi-gem`, `bi-geo-alt`, `bi-gift`, `bi-gift-fill`, `bi-globe2`, `bi-google`, `bi-graph-up-arrow`
- `bi-grid`, `bi-grid-1x2`, `bi-grid-1x2-fill`, `bi-grid-3x3`, `bi-grid-3x3-gap`, `bi-grid-3x3-gap-fill`, `bi-hammer`, `bi-hand-index`, `bi-hand-index-thumb`, `bi-hand-index-thumb-fill`, `bi-hand-thumbs-up`, `bi-hand-thumbs-up-fill`, `bi-headset`, `bi-heart`, `bi-heart-fill`, `bi-heart-pulse`
- `bi-hourglass-split`, `bi-house-door-fill`, `bi-house-heart`, `bi-image`, `bi-image-alt`, `bi-images`, `bi-inbox`, `bi-info-circle`, `bi-info-circle-fill`, `bi-info-lg`, `bi-input-cursor-text`, `bi-journal-richtext`, `bi-journal-text`, `bi-kanban`, `bi-laptop`, `bi-layers`
- `bi-layers-fill`, `bi-layout-sidebar-inset`, `bi-layout-sidebar-inset-reverse`, `bi-layout-split`, `bi-layout-text-sidebar-reverse`, `bi-layout-text-window-reverse`, `bi-layout-wtf`, `bi-lightbulb`, `bi-lightbulb-fill`, `bi-lightning-charge`, `bi-lightning-charge-fill`, `bi-link-45deg`, `bi-list`, `bi-list-check`, `bi-list-task`, `bi-list-ul`
- `bi-lock`, `bi-magic`, `bi-megaphone`, `bi-megaphone-fill`, `bi-mic`, `bi-moon-stars`, `bi-mortarboard`, `bi-mouse`, `bi-mouse2`, `bi-newspaper`, `bi-palette`, `bi-palette-fill`, `bi-palette2`, `bi-paperclip`, `bi-patch-check`, `bi-patch-check-fill`
- `bi-pencil`, `bi-pencil-square`, `bi-people-fill`, `bi-person`, `bi-person-arms-up`, `bi-person-badge`, `bi-person-bounding-box`, `bi-person-check`, `bi-person-check-fill`, `bi-person-circle`, `bi-person-fill`, `bi-person-gear`, `bi-person-lines-fill`, `bi-person-lock`, `bi-person-plus`, `bi-person-slash`
- `bi-person-standing`, `bi-person-standing-dress`, `bi-person-walking`, `bi-phone`, `bi-pin-angle`, `bi-pin-angle-fill`, `bi-play-btn`, `bi-play-fill`, `bi-plugin`, `bi-plus`, `bi-plus-circle`, `bi-plus-lg`, `bi-plus-square`, `bi-power`, `bi-puzzle`, `bi-puzzle-fill`
- `bi-question-circle`, `bi-question-lg`, `bi-quote`, `bi-reception-4`, `bi-robot`, `bi-rulers`, `bi-scissors`, `bi-search`, `bi-send`, `bi-send-check`, `bi-send-fill`, `bi-shield`, `bi-shield-check`, `bi-signpost-split`, `bi-slash-circle`, `bi-sliders`
- `bi-sliders2`, `bi-sort-down`, `bi-soundwave`, `bi-speedometer`, `bi-speedometer2`, `bi-square`, `bi-square-fill`, `bi-square-half`, `bi-stack`, `bi-star`, `bi-star-fill`, `bi-stars`, `bi-stop-circle`, `bi-stop-fill`, `bi-stopwatch`, `bi-sun`
- `bi-table`, `bi-tablet-landscape`, `bi-tencent-qq`, `bi-three-dots`, `bi-ticket-perforated`, `bi-toggle2-off`, `bi-tools`, `bi-translate`, `bi-transparency`, `bi-trash`, `bi-trash3`, `bi-tree-fill`, `bi-tv`, `bi-ui-checks-grid`, `bi-unlock`, `bi-upload`
- `bi-vector-pen`, `bi-view-list`, `bi-wallet2`, `bi-wechat`, `bi-wifi`, `bi-wind`, `bi-window`, `bi-window-fullscreen`, `bi-window-sidebar`, `bi-window-stack`, `bi-windows`, `bi-x`, `bi-x-circle`, `bi-x-lg`, `bi-zoom-in`, `bi-zoom-out`

### 8.2 Lucide React（134）

- `Activity`, `AlertTriangle`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowUpRight`, `BookOpen`, `Bot`, `Boxes`, `Braces`, `Brain`, `Brush`, `Camera`, `Check`, `CheckCircle2`, `CheckIcon`
- `ChevronDown`, `ChevronDownIcon`, `ChevronRight`, `ChevronUp`, `ChevronUpIcon`, `Circle`, `CircleAlert`, `CircleDot`, `ClipboardCheck`, `Clock3`, `Code2`, `Compass`, `Copy`, `Cpu`, `Crop`, `Database`
- `Download`, `Ellipsis`, `Eraser`, `Expand`, `ExternalLink`, `Eye`, `FileCheck2`, `FileClock`, `FileCode2`, `FilePenLine`, `FileText`, `FileUp`, `Focus`, `FolderOpen`, `FolderPlus`, `Gamepad2`
- `Gauge`, `Grid2x2`, `Group`, `Hand`, `HardDrive`, `HelpCircle`, `History`, `Home`, `Image`, `ImageIcon`, `ImagePlus`, `ImageUp`, `Images`, `Info`, `KeyRound`, `Keyboard`
- `Layers3`, `LayoutGrid`, `LayoutTemplate`, `Link2`, `List`, `ListChecks`, `ListRestart`, `LoaderCircle`, `Lock`, `LockKeyhole`, `LockOpen`, `Maximize2`, `MessageSquare`, `MessageSquareText`, `Minus`, `MonitorSmartphone`
- `MousePointer2`, `Music2`, `Orbit`, `PackageCheck`, `PackageOpen`, `PackageSearch`, `Palette`, `PanelLeftClose`, `PanelLeftOpen`, `PanelRightClose`, `PanelTop`, `PenLine`, `Pencil`, `PencilLine`, `Pin`, `Play`
- `PlugZap`, `Plus`, `Puzzle`, `Redo2`, `RefreshCw`, `RotateCcw`, `RotateCw`, `Rows3`, `Scissors`, `Search`, `Settings2`, `Shield`, `ShieldAlert`, `ShieldCheck`, `ShieldOff`, `ShoppingBag`
- `Shrink`, `SlidersHorizontal`, `Sparkles`, `Square`, `Star`, `Terminal`, `TerminalSquare`, `Trash2`, `TriangleAlert`, `Type`, `Undo2`, `Upload`, `Video`, `View`, `WandSparkles`, `Webhook`
- `Workflow`, `Wrench`, `X`, `XCircle`, `ZoomIn`, `ZoomOut`

`Image` 在部分文件中以 `ImageIcon` 为本地别名导入；索引同时保留了直接导入的 `ImageIcon`，两者是源码中出现的实际导入名称。

### 8.3 Element Plus Icons（63）

- `AlarmClock`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Back`, `Bell`, `Box`, `Calendar`, `ChatDotRound`, `Check`, `CircleCheck`, `CircleClose`, `CircleCloseFilled`, `Close`, `Coin`, `Collection`
- `CollectionTag`, `Connection`, `CopyDocument`, `Cpu`, `DataAnalysis`, `Delete`, `Document`, `Download`, `EditPen`, `Expand`, `Files`, `Fold`, `Goods`, `Hide`, `Histogram`, `Link`
- `List`, `Loading`, `Lock`, `MagicStick`, `Monitor`, `Moon`, `Odometer`, `Operation`, `Picture`, `Plus`, `Pointer`, `Rank`, `Reading`, `Refresh`, `Search`, `Setting`
- `ShoppingBag`, `Star`, `Sunny`, `SwitchButton`, `Ticket`, `TrendCharts`, `Upload`, `UploadFilled`, `User`, `UserFilled`, `VideoPlay`, `View`, `Wallet`, `Warning`, `WarningFilled`

### 8.4 Flutter Material Icons（223）

- `accessibility_new`, `account_balance_wallet_outlined`, `account_tree_outlined`, `add`, `add_circle_outline`, `add_circle_outline_rounded`, `add_comment_outlined`, `add_photo_alternate_outlined`, `add_rounded`, `alternate_email`, `architecture_outlined`, `arrow_back_ios_new_rounded`, `arrow_forward_rounded`, `aspect_ratio_outlined`, `aspect_ratio_rounded`, `auto_awesome`
- `auto_awesome_outlined`, `auto_awesome_rounded`, `auto_fix_high`, `auto_fix_high_outlined`, `autorenew`, `badge_outlined`, `bolt_outlined`, `bolt_rounded`, `branding_watermark_outlined`, `brightness_auto_outlined`, `broken_image_outlined`, `bug_report_outlined`, `build_outlined`, `calendar_month_outlined`, `campaign`, `campaign_outlined`
- `cancel_outlined`, `card_giftcard_outlined`, `category_outlined`, `celebration_outlined`, `center_focus_strong_outlined`, `chat_bubble_outline`, `check`, `check_circle`, `check_circle_outline`, `check_circle_rounded`, `check_rounded`, `checklist_rounded`, `chevron_right`, `chevron_right_rounded`, `circle_outlined`, `close`
- `close_rounded`, `cloud_done_outlined`, `cloud_off_outlined`, `cloud_upload_outlined`, `collections_outlined`, `color_lens_outlined`, `confirmation_number_outlined`, `copy_outlined`, `create_new_folder_outlined`, `dark_mode_outlined`, `dashboard_outlined`, `delete_forever_outlined`, `delete_outline`, `delete_outline_rounded`, `delete_sweep_outlined`, `dns_outlined`
- `done`, `done_all`, `download_outlined`, `drag_indicator`, `draw_outlined`, `drive_file_move_outlined`, `edit_note`, `edit_note_rounded`, `edit_outlined`, `error_outline`, `error_rounded`, `event_available`, `event_busy_outlined`, `expand_more`, `face_retouching_natural_outlined`, `favorite_border_rounded`
- `favorite_rounded`, `feedback_outlined`, `filter_alt_off`, `filter_alt_off_outlined`, `filter_list`, `filter_none_rounded`, `folder_delete_outlined`, `folder_off_outlined`, `folder_outlined`, `format_quote_rounded`, `forum_outlined`, `fullscreen`, `graphic_eq_rounded`, `grid_on_outlined`, `grid_view_outlined`, `group_add_outlined`
- `groups`, `groups_outlined`, `hd_outlined`, `health_and_safety_outlined`, `history`, `history_outlined`, `history_rounded`, `home_outlined`, `home_rounded`, `hourglass_empty`, `hourglass_top`, `hourglass_top_outlined`, `hourglass_top_rounded`, `image_not_supported_outlined`, `image_outlined`, `inbox_outlined`
- `info_outline`, `info_outline_rounded`, `info_rounded`, `insights_outlined`, `inventory_2_outlined`, `ios_share_outlined`, `keyboard_arrow_down`, `keyboard_arrow_down_rounded`, `keyboard_arrow_up_rounded`, `landscape_outlined`, `layers_clear_outlined`, `light_mode_outlined`, `lightbulb_outline`, `lightbulb_outline_rounded`, `link`, `location_on_outlined`
- `lock_outline`, `lock_outline_rounded`, `login`, `logout`, `logout_rounded`, `manage_accounts_outlined`, `manage_search_outlined`, `mark_chat_read_outlined`, `mark_email_read_outlined`, `mark_email_unread_outlined`, `memory`, `mic_none_outlined`, `mic_none_rounded`, `more_horiz_rounded`, `motion_photos_on_outlined`, `movie_creation_outlined`
- `new_releases_outlined`, `north_east_rounded`, `notes_outlined`, `notifications_active_outlined`, `notifications_none`, `notifications_outlined`, `open_in_new`, `open_in_new_rounded`, `palette`, `palette_outlined`, `palette_rounded`, `password`, `payments_outlined`, `pending_actions`, `person_outline`, `person_outline_rounded`
- `person_rounded`, `photo_camera_outlined`, `photo_library_outlined`, `photo_outlined`, `photo_size_select_actual_outlined`, `price_check_outlined`, `psychology_outlined`, `public`, `public_outlined`, `push_pin_outlined`, `push_pin_rounded`, `qr_code_2`, `qr_code_scanner`, `radio_button_unchecked`, `receipt_long_outlined`, `redeem`
- `redeem_outlined`, `refresh`, `refresh_rounded`, `remove`, `replay`, `restore_outlined`, `schedule`, `schedule_outlined`, `search`, `search_off`, `search_off_outlined`, `search_rounded`, `sell_outlined`, `send_outlined`, `send_rounded`, `share_outlined`
- `shopping_bag_outlined`, `speed`, `stars_outlined`, `stars_rounded`, `stop_circle_outlined`, `stop_rounded`, `swap_horiz`, `sync`, `sync_problem_outlined`, `task_alt`, `thumb_up_outlined`, `thumb_up_rounded`, `title`, `toll_outlined`, `touch_app_outlined`, `trending_up`
- `tune_rounded`, `update`, `upload_file_outlined`, `verified_outlined`, `verified_user_outlined`, `view_carousel_outlined`, `view_in_ar`, `view_in_ar_outlined`, `view_quilt_outlined`, `visibility_off_outlined`, `warning_amber_rounded`, `web_asset_outlined`, `workspace_premium`, `workspace_premium_outlined`, `workspace_premium_rounded`

## 九、维护和定位方法

### 9.1 查某个图标在哪些文件使用

```bash
# Bootstrap
rg -n 'bi-download' apps/web-react/src

# Lucide
rg -n '\bDownload\b' apps/web-react/src/canvas apps/web-react/src/views

# Element Plus
rg -n '\bDownload\b' apps/admin/src

# Flutter
rg -n 'Icons\.download_outlined' apps/mobile/lib
```

### 9.2 替换图标时应改哪里

- 主站导航：改 `apps/web-react/src/layout/NavBar.jsx`。
- 后台侧边栏：改 `apps/admin/src/AdminLayout.vue`。
- 移动端底栏：改 `apps/mobile/lib/features/shell/app_shell.dart`。
- 移动端页面路由图标：改 `apps/mobile/lib/app/app_router.dart`。
- 无限画布顶部工具：改 `apps/web-react/src/canvas/components/canvas/canvas-toolbar.tsx`。
- 无限画布图片工具：改 `apps/web-react/src/canvas/components/canvas/canvas-image-toolbar-tools.tsx`。
- 模型品牌图标：替换 `apps/web-react/public/icons/` 中对应 SVG，并保留文件名可避免改代码。
- 产品 Logo/默认头像：替换 `apps/web-react/public/brand/` 中对应 SVG。
- Android/iOS 桌面图标：必须更新各尺寸资源，不能只替换一个网页 Logo。

### 9.3 注意事项

1. `public/` 中的 SVG 会使用固定 URL；替换同名文件时需要考虑浏览器和对象缓存。
2. Lucide、Element Plus、Material 图标是代码依赖，不应复制到 `public/icons/`。
3. 同一个图标名称可能在多个页面使用，删除依赖前必须全仓检查。
4. `@ant-design/icons` 当前未使用；若确认以后也不使用，可以另行评估移除依赖，但本次只记录、不修改。
5. `.DS_Store` 不是图标，正式提交时建议忽略；本次没有删除用户文件。
6. 本文清点的是源码中的静态引用。后续插件或后台动态工具新增图标后，应同步更新本文。
