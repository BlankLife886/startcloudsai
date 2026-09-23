# StarCloudsAI 管理端

管理端是 Vue 3 + Vite + TypeScript strict + Pinia + Vue Router + Element Plus 的轻量 SPA。它部署在 `/admin/`，使用独立的 `admin_accounts`、`admin_sessions`、`sc_admin_session` 和 `/api/v1/admin/auth/*`，不接受用户端账号或 `sc_session`。

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

首页的布局、指标单位、时间窗口和失败状态说明见 [后台首页说明](../../docs/ADMIN_DASHBOARD.md)，页面右上角「说明」也提供使用指引。

财务核对、日志导出、安全处理、Agent 质量与用户画像使用方式见 [运维工作台说明](../../docs/ADMIN_OPERATIONS_GUIDE.md)。

| 路由 | 功能 |
| --- | --- |
| `/login` | 独立管理员邮箱 + 密码登录 |
| `/forbidden` | 管理员认证异常状态页 |
| `/` | 用户、任务、余额、任务类型分布与运行中任务概览 |
| `/users` | 用户搜索、封禁、角色、钱包调整、详情与账本 |
| `/tasks` | 全站任务筛选、详情、取消、强制失败和失败任务重入队 |
| `/model-config` | 模型、能力、上游路由与图片尺寸配置 |
| `/profitability` | 创作任务、助手与开发者 API 的成本、收入和利润统计 |
| `/agent-quality` | Agent 运行质量与问题诊断 |
| `/canvas-templates` | 上传、编辑、排序、发布和下架无限画布 v3 模板 |
| `/prompt-library` | 提示词条 CRUD、封面上传、外部数据源和手动同步 |
| `/image-skills` | 官方技能的调用名、正文、分类、排序与发布状态管理 |
| `/ecommerce` | 电商素材分类、多图上传、AI 图片标题、多选删除、拖拽排序与上下架 |
| `/community` | 画廊分类、投稿规则、创作者聚合与解禁 |
| `/gallery` | 投稿审核、策展、违规下架与禁投 |
| `/codes` | 批量生成、查询和停用兑换码，查看批次统计 |
| `/plans`、`/orders` | 套餐与订单管理 |
| `/finance-center`、`/subscription-changes` | 财务中心与订阅变更记录 |
| `/trial-applications`、`/checkin-activity`、`/growth-groups` | 体验活动、签到与好友拼团配置/记录 |
| `/feedback`、`/referrals` | 用户反馈与邀请返利管理 |
| `/audit` | 管理端写操作审计日志 |
| `/announcements` | 公告编辑、发布、启停与立即推送 |
| `/changelog` | 更新说明编辑、发布、焦点版本与导入导出 |
| `/home-banners` | 首页轮播原图、跳转、排序和发布计划 |
| `/page-controls` | 51 项页面控制，支持分组/搜索/状态筛选、整组调整和访问提示 |
| `/settings` | 任务价格/模型、并发、注册与赠送配置、管理员改密、测试 chatgpt2api |
| `/platform-logs`、`/security-center` | 平台运行日志与安全管理 |

上述路径相对于 `/admin/`。以 `src/router.ts` 为准；另有公开的 `/finance-preview` 模拟页面，不能把模拟数据当作真实财务结果。

## 实现约定

大数据量列表的筛选、时间口径、分页边界与索引说明见 [后台列表查询](../../docs/ADMIN_LIST_SEARCH.md)。

- `src/request.ts` 负责 Cookie、统一响应解包、错误提示和 401 跳转。
- API 金额使用整数分（`*Cents`）；UI 显示元，转换集中在 `src/utils.ts`。
- `CursorPager.vue` 统一分页交互；总数未知时只显示当前页和前后翻页，不估算总数。固定每页条数的列表不显示无效的条数选择器。
- `usePagedList.ts` 缓存已访问页的 cursor，读取成功后同时更新页码与内容；跨未访问页按接口游标依次读取，失败保留原页，重试继续原目标。`useClientPagination.ts` 负责已完整加载列表的分页，改变条数回到第一页。
- Element Plus 组件按需导入，声明文件由插件生成在 `src/auto-imports.d.ts` 和 `src/components.d.ts`。
- ECharts 按需注册并通过 `src/components/EChart.vue` 统一封装。
- 浅色/深色主题由 `src/theme.ts` 管理并写入 localStorage；设计令牌见 `src/styles/theme.css`。
- 路由页面懒加载，公共布局在 `src/AdminLayout.vue`。
- 管理端监听 Vite 动态分包加载错误；镜像更新导致旧页面引用已移除的 hash 文件时，会在 30 秒保护窗口内自动刷新一次，避免黑屏。

后端当前已实现管理端使用的扁平字段（如 `userEmail`、`planName`、`balanceCents`）和管理员文件读取权限。未知的账本 `kind`/`sourceType` 仍按原值展示；任务页的错误码筛选只过滤当前已加载页面，因为 API 暂无 `errorCode` 查询参数。

当前代码已注册订单、套餐和财务相关页面及接口；支付能否实际使用仍取决于服务端运行配置和渠道状态。管理员账号不通过用户端注册产生，使用 `server create-admin` 创建或更新；后台只接受独立管理员邮箱和密码，不存在管理员密钥。

## Docker

```bash
docker build -t starcloudsai-admin .
docker run --rm -p 8081:80 starcloudsai-admin
```

访问 `http://localhost:8081/admin/`。单独运行容器时不会代理 `/api`；完整部署应使用根目录 Compose 和统一网关。

API 见 [../../docs/API_CONTRACT.md](../../docs/API_CONTRACT.md)，视觉规范见 [../../docs/ADMIN_UI_STYLE.md](../../docs/ADMIN_UI_STYLE.md)。

页面控制的覆盖范围、默认状态及验证方式见 [../../docs/PAGE_CONTROLS.md](../../docs/PAGE_CONTROLS.md)。

公告实时同步与立即推送的行为及发布要求见 [../../docs/ANNOUNCEMENT_PUSH.md](../../docs/ANNOUNCEMENT_PUSH.md)。
