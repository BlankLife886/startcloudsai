# StarCloudsAI 管理端

管理端是 Vue 3 + Vite + TypeScript strict + Pinia + Vue Router + Element Plus 的轻量 SPA。它部署在 `/admin/`，使用独立的 `admin_accounts`、`admin_sessions`、`sc_admin_session` 和 `/api/admin/auth/*`，不接受用户端账号或 `sc_session`。

## 开发与构建

```bash
npm ci
npm run dev        # http://localhost:3200/admin/；/api -> http://localhost:8000
npm run typecheck
npm run build      # vue-tsc --noEmit + vite build
npm run preview
```

Vite 的 `base` 固定为 `/admin/`。直接打开开发地址时应保留尾部斜杠。

## 页面

| 路由 | 功能 |
| --- | --- |
| `/login` | 独立管理员邮箱 + 密码登录 |
| `/forbidden` | 管理员认证异常状态页 |
| `/` | 用户、任务、余额、任务类型分布与运行中任务概览 |
| `/users` | 用户搜索、封禁、角色、钱包调整、详情与账本 |
| `/tasks` | 全站任务筛选、详情、取消、强制失败和失败任务重入队 |
| `/prompt-library` | 提示词条 CRUD、封面上传、外部数据源和手动同步 |
| `/community` | 画廊分类、投稿规则、创作者聚合与解禁 |
| `/gallery` | 投稿审核、策展、违规下架与禁投 |
| `/codes` | 批量生成、查询和停用兑换码，查看批次统计 |
| `/audit` | 管理端写操作审计日志 |
| `/content` | 公告和更新说明 CRUD |
| `/settings` | 任务价格/模型、并发、注册与赠送配置、管理员改密、测试 chatgpt2api |

## 实现约定

- `src/request.ts` 负责 Cookie、统一响应解包、错误提示和 401 跳转。
- API 金额使用整数分（`*Cents`）；UI 显示元，转换集中在 `src/utils.ts`。
- 列表 API 使用 cursor 分页；`CursorPager.vue` 保存历史 cursor 实现上一页。
- Element Plus 组件按需导入，声明文件由插件生成在 `src/auto-imports.d.ts` 和 `src/components.d.ts`。
- ECharts 按需注册并通过 `src/components/EChart.vue` 统一封装。
- 浅色/深色主题由 `src/theme.ts` 管理并写入 localStorage；设计令牌见 `src/styles/theme.css`。
- 路由页面懒加载，公共布局在 `src/AdminLayout.vue`。
- 管理端监听 Vite 动态分包加载错误；镜像更新导致旧页面引用已移除的 hash 文件时，会在 30 秒保护窗口内自动刷新一次，避免黑屏。

后端当前已实现管理端使用的扁平字段（如 `userEmail`、`planName`、`balanceCents`）和管理员文件读取权限。未知的账本 `kind`/`sourceType` 仍按原值展示；任务页的错误码筛选只过滤当前已加载页面，因为 API 暂无 `errorCode` 查询参数。

支付、订单和套餐页面已移除。管理员账号不通过用户端注册产生，使用 `server create-admin` 创建或更新；后台只接受独立管理员邮箱和密码，不存在管理员密钥。

## Docker

```bash
docker build -t starcloudsai-admin .
docker run --rm -p 8081:80 starcloudsai-admin
```

访问 `http://localhost:8081/admin/`。单独运行容器时不会代理 `/api`；完整部署应使用根目录 Compose 和统一网关。

API 见 [../../docs/API_CONTRACT.md](../../docs/API_CONTRACT.md)，视觉规范见 [../../docs/ADMIN_UI_STYLE.md](../../docs/ADMIN_UI_STYLE.md)。
