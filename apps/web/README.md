# StarCloudIsAI Web（星空云绘用户端）

`apps/web` 是星空云绘用户端，基于 Vue 3 + Vite + Pinia。面向普通用户提供 AI 图像创作（文生图、插画染色、UI 设计稿、超高清模型图、游戏设计、AI 拼图）、共享画廊、钱包充值与个人中心。

后端为 `apps/server`（Go 后端（Gin）），接口契约见 `docs/API_CONTRACT.md`。所有请求统一走 `/api` 前缀，鉴权使用 HttpOnly Cookie。

## 本地开发

```bash
npm install
npm run dev        # http://localhost:3102，/api 代理到 http://localhost:8000
```

如需指向其他后端，设置 `VITE_API_PROXY_TARGET`。

构建与检查：

```bash
npm run build           # 产物输出到 dist/
npm run check:imports   # 静态检查是否存在悬空 import
npm run lint
```

## Docker 部署

```bash
docker build -t starcloudsai-web .
docker run -p 8080:80 starcloudsai-web
```

镜像用 node:22-alpine 构建，nginx:alpine 托管 `dist`（SPA fallback 到 index.html，配置见 `nginx.conf`）。生产环境由外层 gateway 将 `/api` 反代到 Go 后端（Gin）。

## 主要页面

- `/`：首页（AI 创作入口 + 画廊精选）。
- `/text-to-image`：文生图工作台。
- `/ai-illustration-coloring`：插画染色。
- `/design-workshop`：UI 设计稿。
- `/model-sheet`：超高清模型图。
- `/game-art`：游戏设计素材。
- `/ai-puzzle`：AI 拼图。
- `/share`：共享画廊（公开已过审作品）。
- `/pricing`：钱包余额、创作单价、充值套餐、订单与账本。
- `/profile`：个人中心（数据总览、我的作品、我的投稿、通知、账号设置，需登录）。
- `/app-space`、`/updates`：应用空间与更新说明。
- `/auth`：登录 / 注册（邮箱 + 密码）。

## 服务层结构

- `src/services/apiClient.js`：统一 fetch 封装（`{success,data}` 解析、带 code 的 ApiError、AbortSignal）。
- `src/services/tasksApi.js`：任务契约（createTask / getTask / listTasks / cancelTask / deleteTask / uploadFile / waitForTask，2s 轮询）。
- `src/services/aiWallpaper.js`：旧「job」链路 → 新「task」契约的适配层，三套工作台组合式函数经由它访问网络。
- `src/services/auth.js` + `src/stores/auth.js`：认证（/api/auth/*）。
- `src/services/meApi.js`：个人中心（资料 / 总览 / 钱包 / 账本 / 通知 / 我的投稿）。
- `src/services/billingApi.js`：套餐与订单。
- `src/services/metaApi.js`：单价 / 更新说明 / 公告。
- `src/services/shareGallery.js`：画廊列表与投稿。
