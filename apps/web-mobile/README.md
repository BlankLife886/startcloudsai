# 星空云绘手机站（/m）

面向手机浏览器的独立前端，挂在主站同源的 `/m` 路径下，与桌面站共用登录 Cookie 和后端接口。

- 技术栈：React 19 + Vite + antd-mobile 5（命令式弹层的 React 19 兼容见 `src/app/reactCompat.js`）。
- 业务层共用：接口、鉴权、任务提交与轮询等直接引用 `apps/web-react/src`（别名 `@react`、`@`），本应用只写界面与交互。
- 登录沿用主站 `/auth`，完成后整页跳回 `/m/...`。

## 开发

```bash
npm install
npm run dev
```

开发服务器运行在 3106，桌面站开发服务器（3105）已把 `/m` 代理过来；请通过 `http://localhost:3105/m/` 访问，这样与线上一样同源、共用登录态。

## 页面结构

界面与 Flutter App（`apps/mobile`）保持一致：同一套设计令牌（`src/styles/base.css`，取自 `apps/mobile/lib/app/starclouds_theme.dart`：墨黑主色、冷灰底、白卡片、圆角 12/16/24/28），同样的五个 Tab 与悬浮深色底栏（`src/app/TabBar.jsx`，可按住左右滑动挑选）。改界面时先对照 App 的同名页面。

底部 Tab 外壳（`src/app/TabsLayout.jsx`）：访问过的页面保持挂载，切回时内容与滚动位置保留；再点当前 Tab 回到顶部；输入框聚焦（键盘弹出）时 Tab 栏收起。从 Tab 打开的二级页（如文生图）不显示底栏，同样保持挂载。

| 路径 | 页面 | 状态 |
|---|---|---|
| `/m/home` | 首页 | 品牌栏 + 首页/提示词/社区子 Tab：输入框直达文生图、灵感精选；`?tab=prompts` 为提示词瀑布流（原 `/m/inspire`，旧地址自动跳转）；社区暂跳电脑版 |
| `/m/design` | 设计 | 创作工具（文生图）与我的创作入口 |
| `/m/assistant` | 助手 | 业务与消息渲染直接复用桌面端 `useAssistantWorkspaceController` + `AssistantMessageRow`（问答 / Agent / 图片三种模式、方案确认、自动授权、统计卡片、套图、记忆、纠正与追问建议都一致）；外壳按 App：顶栏历史 /“模式 · 模型 ⌄”/ 新对话，欢迎页与建议卡，“+”工具面板（附件、图片参数、自动授权、记忆），胶囊输入框（语音、发送/停止、排队），历史对话（搜索、重命名、置顶、归档、删除、已归档），费用确认与看图换成底部弹层。共享源码里的 `@canvas/*` 在 vite.config.js 里换成空模块 |
| `/m/orders` | 订单 | 占位，先跳电脑版订单 |
| `/m/me` | 我的 | 身份与数据（积分/历史/素材）、内容管理、权益与服务、设置与支持；子页面暂跳电脑版 |
| `/m/create` | 文生图（二级页） | 与 App 一致的对话式时间线：最新一组贴着底部，往上滑自动加载历史（保持位置不跳）；每组为提示词气泡 + 单张大图 / 多张横滑 + 规格与总耗时；底部参数条（点开“生成设置”）+ 输入卡片（“+”参考图、消耗积分按钮）；点图全屏查看，长按图片或气泡出操作菜单 |

## 局域网真机调试

真机测体验要用正式构建（开发模式会逐个加载几百个未打包的模块，React 也是开发版，手机上明显卡顿）：

1. `apps/web-mobile` 里运行 `npm run lan`：构建并在 3108 提供正式版。
2. `apps/web-react` 里运行 `npm run dev:lan`：3107 监听所有网卡，`/m` 转发到 3108，`/api` 转发到后端，并把写请求的 Origin 改写为 `http://localhost:3105` 以通过后端白名单（仅开发用）。
3. 手机访问 `http://<本机局域网 IP>:3107/m/`。代码改动后需重新执行第 1 步。

电脑上调试仍用 `npm run dev`（3106，经 `http://localhost:3105/m/` 访问，支持热更新）。

## 性能约定

- **页面绝不能被横向撑宽**：布局视口一旦变宽，手机浏览器会缩放整页，固定栏错位、点击失灵、滚动处处卡（2026-10-07 整站卡顿的根因）。网格列一律写 `minmax(0, 1fr)`，不要写裸 `1fr`；`html/body` 已设 `overflow-x: clip` 与 `overflow-wrap: anywhere` 兜底。
- 改完用 `scripts/perf-probe.mjs`（Playwright）回归（模拟手机视口与降速 CPU，记录帧耗时、长任务、布局宽度），不要只凭截图判断。
- 弹层一律用 `src/components/overlay`（`BottomSheet`、`ImageViewer`、`Toast`/`Dialog`/`ActionSheet`），不用 antd-mobile 的 Popup / Mask / Dialog / ActionSheet / ImageViewer / Toast：它们用 react-spring 逐帧跑 JS 动画，锁滚动时还在整页挂非 passive 的 touchmove，手机上弹窗和弹窗内滑动都卡。新弹层只过渡 transform/opacity，锁滚动只改一次 body 样式。
- 不用 antd-mobile 的 `PullToRefresh`（非 passive 触摸监听会拖慢整页滚动），用 `src/components/PullRefresh.jsx`。
- 后台 Tab 页保持挂载但不应响应全局事件（滚动等），页面组件会收到 `active` 属性。
- 点击要立即响应，不为区分双击而延迟单击。
- 固定/吸顶栏不用 `backdrop-filter` 毛玻璃，用实色背景。
- 列表图片先用缩略图，大图只在查看时加载；长列表卡片加 `content-visibility: auto`。
