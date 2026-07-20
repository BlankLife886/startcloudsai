# Walleven Web

`apps/web` 是 Walleven 用户端，基于 Vue 3 + Vite + Pinia。它面向普通用户提供 Wallhaven 壁纸搜索、预览、收藏、下载、设置、AI 壁纸处理和平台 Key 使用入口。

## 本地开发

```bash
pnpm --filter @walleven/web dev
```

默认地址：

```text
http://localhost:3002
```

构建：

```bash
pnpm --filter @walleven/web build
pnpm --filter @walleven/web build:pages
```

E2E：

```bash
pnpm --filter @walleven/web test:e2e
```

## 主要页面

- `/`：首页，展示热门/最新/推荐入口。
- `/search`：Wallhaven 搜索工作台。
- `/wallpaper/:id`：壁纸详情。
- `/favorites`、`/history`、`/downloads`：收藏、浏览历史和下载记录。
- `/settings`：主题、搜索、下载、性能、AI、云同步和 secrets 设置。
- `/profile`：用户中心（需登录）。
- `/auth/login`、`/auth/register`、`/auth/forgot-password`、`/auth/reset-password`：独立登录注册与找回密码流程。
- `/pricing`：套餐、模型价格和用户 OpenAI-compatible Key 入口。
- `/ai-wallpaper`：AI 壁纸工作台。
- `/ai-image-to-3d`：图转模型入口。
- `/ai-puzzle`：本地拼图/拼贴工具。
- `/users`、`/tags`、`/updates`、`/app-space`：作者、标签、更新说明和应用空间。

## 核心模块

- `src/services/api.js`：统一 API client、CSRF、用户端请求。
- `src/services/runtimeConfig.js`：后台 runtime config 和客户端策略。
- `src/stores/*`：认证、设置、收藏、历史、下载、运行时配置。
- `src/features/search/*`：搜索请求、URL 状态、批量动作、预览交互。
- `src/components/wallpaper/fullscreen-preview/*`：全屏预览、canvas-safe 图片加载、滤镜、裁切、AI、样机、下载。
- `src/features/ai-wallpaper/*`：AI 壁纸页面状态和生成工作流。
- `src/features/ai-puzzle/*`：本地拼图编辑器和 PNG 导出。

## API 和环境

开发时 Vite proxy 会把 `/api/*` 转发到本地 Worker。生产构建通常使用：

```bash
VITE_API_BASE_URL=/api
VITE_BROWSER_DOWNLOADS=true
```

AI 临时上传默认走 `${VITE_API_BASE_URL}/ai-temp-upload`，也可以用 `VITE_AI_TEMP_UPLOAD_URL` 覆盖。

## 数据边界

- 登录用户的 settings/favorites/history 会同步到后端。
- Wallhaven API Key、AI provider key 等敏感设置通过 `/api/user/secrets/*` 进入后端加密存储。
- 游客状态会限制 NSFW、Wallhaven API Key、云同步和部分 AI 能力。
- 下载由浏览器下载管理器处理，页面不能直接写入用户指定本地目录。
