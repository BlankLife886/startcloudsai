# StarCloudIsAI Web（用户端）

用户端基于 Vue 3、Vite、Pinia、Vue Router 和 Tailwind CSS 4。GSAP、anime.js 与 Three.js 用于首页和部分工作台动效；Bootstrap Icons 提供界面图标。

所有业务请求使用同源 `/api`，鉴权凭据为 HttpOnly Cookie。生产构建由 nginx 托管，并由仓库根网关统一转发 API。

## 开发与验证

```bash
npm ci
npm run dev        # http://localhost:3102；/api -> http://localhost:8000
```

可在 `.env.development` 或 shell 中设置 `VITE_API_PROXY_TARGET` 修改代理目标。常用检查：

```bash
npm run check:imports
npm run lint
npm run build
npm run test:image-sizes
npm run test:transparent-upscale
npm run test:coloring-upload-compression
```

`playwright.config.js` 仍引用旧 monorepo 的 `@walleven/*` pnpm filter，当前 `tests/e2e` 也只有 helper；在重建 web/API/admin 的测试启动器和实际 spec 前，`npm run test:e2e` 不是可用的验证命令。`npm run build` 输出到 `VITE_BUILD_OUT_DIR`，未设置时为 `dist/`。

## 页面

| 路由 | 功能 |
| --- | --- |
| `/` | 云上美术馆首页、六个创作入口、公开画廊内容 |
| `/share` | 已审核作品画廊，支持分类和精选筛选 |
| `/text-to-image` | 文生图工作台 |
| `/ai-illustration-coloring` | 插画染色 |
| `/design-workshop` | UI 设计稿 |
| `/model-sheet` | 超高清模型图 |
| `/game-art` | 游戏美术素材 |
| `/ai-puzzle` | AI 拼图 |
| `/pricing` | 价格、只读套餐、创作单价与支付接入状态；支付按钮当前禁用 |
| `/profile` | 我的作品、投稿、钱包/兑换码、通知，以及头像、个人资料和密码安全设置 |
| `/app-space` | 应用空间 |
| `/updates` | 更新说明 |
| `/auth` | 登录/注册/找回密码：GitHub 一键继续；邮箱验证码注册；邮箱密码登录；验证码重置密码 |
| `/access-limited` | 访问受限状态页 |

`/ai-wallpaper` 是兼容旧链接的重定向，不是独立页面。

## 代码结构

```text
src/
├── assets/                 # 全局样式与静态资源
├── components/             # 应用壳、首页与通用组件
├── composables/            # 钱包余额等跨页面逻辑
├── features/               # 拼图、分享、首页动效、设计工作坊等领域模块
├── router/                 # 路由、标题、认证与运行时开关守卫
├── services/               # API、认证、任务、计费、画廊与客户端状态
├── i18n/                   # 用户端中/英/繁界面文案与兼容翻译层
├── stores/                 # auth、appearance、locale、runtimeConfig、settings
└── views/                  # 路由页面
```

关键服务：

- `apiClient.js`：统一 `fetch`、`credentials: include`、响应解包与 `ApiError`。
- `tasksApi.js`：创建、查询、轮询、取消、删除任务和上传文件。
- `aiWallpaper.js`：工作台到统一 task API 的兼容适配层。
- `meApi.js`：个人中心、钱包、通知、投稿和兑换码。
- `shareGallery.js`、`promptLibrary.js`：共享画廊与公开提示词库。
- `runtimeConfig.js`：从后端运营配置构造前端运行时开关。

## Docker

```bash
docker build -t starcloudsai-web .
docker run --rm -p 8080:80 starcloudsai-web
```

单独运行该容器只能浏览静态页面，`/api` 应由根目录 `gateway` 或等效反向代理提供。完整部署请在仓库根目录运行 `docker compose up -d --build`。

用户端支持密码注册和登录，但不提供 Google OAuth。注册与找回密码验证码仅接受 `gmail.com`、`googlemail.com`、`qq.com`，并绑定 `register|reset` 用途，不能跨流程使用；登录使用邮箱和密码。GitHub OAuth 对新用户可自动建立账号。文生图画布底部胶片条、历史瀑布流和个人中心列表只加载 `thumbnailUrls`；主画布与主动打开的放大预览会先显示缩略图，再按需加载 `originalUrls`，下载与后续编辑也使用原图。

个人中心素材库支持用户上传 PNG/JPEG/WebP。上传时服务端同步生成 512px 缩略图；列表仅请求缩略图，点击预览后才读取原图。前端限制单张 10MB、单次最多 6 张，后端限制每账号最多 200 项。

用户端顶栏提供简体中文、English、繁體中文全局切换，选择保存在 `starclouds-locale`。`locale` store 同步 `<html lang>`；`ClientLocaleBridge` 为尚未迁移到显式翻译键的旧工作台提供全局兼容，并同时更新静态文本、placeholder、title 和 aria-label。提示词、用户名、作品标题和简介等用户内容使用 `data-no-translate`，不会被界面语言改写。

前端监听 Vite 动态分包加载错误。Docker 镜像替换后，如已打开的旧页面仍引用上一版 hash 资源，会在 30 秒保护窗口内自动刷新一次并加载新版本，避免路由切换后黑屏或整站挂起。

文生图提交成功后只合并创建响应并轮询当前任务，不再立即全量刷新历史列表。这样已有图片的签名 URL 和组件缓存保持稳定，不会在每次点击生成时整排黑屏后重新加载。

首页的实际视觉约束见 [DESIGN.md](DESIGN.md)，API 约定见 [../../docs/API_CONTRACT.md](../../docs/API_CONTRACT.md)。
