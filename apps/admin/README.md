# StartClouds 管理后台（apps/admin）

轻量管理后台：Vue 3 + Vite + TypeScript（strict）+ vue-router + Pinia + Element Plus（unplugin 按需自动导入组件）。不使用任何 admin 模板/框架，一个布局组件 + 每页一个文件。

部署在 nginx 网关的 `/admin/` 子路径下，与用户端共用 `/api`（Cookie session，后台要求 `user.role = admin`）。

## 开发

```bash
npm install
npm run dev        # http://localhost:5174/admin/，/api 代理到 http://localhost:8000
```

## 构建与检查

```bash
npm run build      # vue-tsc --noEmit（strict 类型检查）+ vite build → dist/
npm run typecheck  # 仅类型检查
npm run preview    # 本地预览构建产物
```

## Docker

```bash
docker build -t startclouds-admin .
docker run -p 8081:80 startclouds-admin   # http://localhost:8081/admin/
```

`nginx.conf` 已处理 `/admin/` 子路径的 SPA fallback（`try_files ... /admin/index.html`）。容器不代理 `/api`，由外层 gateway 统一转发。

## 页面

| 路由 | 说明 |
| --- | --- |
| `/login` | 登录（登录后校验 role=admin，非管理员进无权限页） |
| `/` | 仪表盘：/api/admin/stats 数字卡片 + 近7日任务表（原生进度条） |
| `/users` | 用户搜索分页、封禁/解封、调整余额（元↔分换算、原因必填） |
| `/orders` | 订单筛选分页，pending/paid 可人工补单（二次确认） |
| `/plans` | 套餐 CRUD（价格元↔分、卖点列表、上架开关），删除=下架 |
| `/tasks` | 全站任务监控（筛 type/status/user），详情含 prompt/params/错误/产物缩略图，失败可重新入队 |
| `/gallery` | 画廊审核：大图预览，通过/拒绝（填原因）/下架 |
| `/content` | 公告 CRUD + 更新说明 CRUD 两个 Tab |
| `/settings` | 任务单价、用户并发上限、注册开关、注册赠送金额；测试 chatgpt2api 连通 |

## 约定

- 金额：接口一律整数「分」（`*Cents`），界面一律「元」，转换集中在 `src/utils.ts`（`fenToYuan` / `yuanToFen`）。
- 请求：全部走 `src/request.ts` 的 `request()`（`credentials: 'include'`、统一 `{success,data}` 解包、401 跳登录、错误码中文 toast）。
- 分页：契约为 cursor 分页，列表页用「上一页/下一页」（历史 cursor 栈实现上一页）。

## 契约中未明确、按假定实现的字段（后端如不同请对齐）

1. `GET /api/admin/stats` 响应假定为：`{ totalUsers, newUsersToday, taskDaily: [{date,total,succeeded}], revenueCents, walletBalanceCents }`；字段缺失时卡片显示 `-`。
2. `GET /api/admin/users` 搜索参数假定为 `?search=&status=`；列表项假定含 `balanceCents`（缺失显示 `-`）。
3. `GET /api/admin/tasks` 的用户筛选参数假定为 `?user=`（ID 或邮箱）。
4. 套餐/公告的"上架/生效"字段假定为 `enabled: boolean`。
5. `GET /api/admin/settings` 假定为：`{ taskPrices: {type: cents}, userMaxRunningTasks, registrationEnabled, signupGrantCents }`。
6. `POST /api/admin/settings/test-c2a` 成功响应假定含 `models: string[]` 或 `modelCount`。
7. 订单/任务列表项中的用户与套餐信息兼容 `userEmail` / `user.email` / `userId`、`planName` / `plan.name` 多种形状。
