# StartClouds 管理后台（apps/admin）

轻量管理后台：Vue 3 + Vite + TypeScript（strict）+ vue-router + Pinia + Element Plus（unplugin 按需自动导入组件）。不使用任何 admin 模板/框架，一个布局组件 + 每页一个文件。

部署在 nginx 网关的 `/admin/` 子路径下，与用户端共用 `/api`（Cookie session，后台要求 `user.role = admin`）。

## 开发

```bash
npm install
npm run dev        # http://localhost:3200/admin/，/api 代理到 http://localhost:8000
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
| `/` | 仪表盘：数字卡片 + 近7日任务折线 + 任务类型分布饼图 + 近30日收入柱状（echarts 按需引入） |
| `/users` | 用户搜索分页、封禁/解封、调整余额；点击行打开详情抽屉（概览/账本/订单/任务 四 Tab + 重置密码） |
| `/orders` | 订单筛选分页，pending/paid 可人工补单（二次确认） |
| `/finance` | 财务：totals 卡片（7/30/90 日切换）+ 收入/消耗双折线 + 全站账本流水（筛 kind/sourceType/用户） |
| `/plans` | 套餐 CRUD（价格元↔分、卖点列表、上架开关），删除=下架 |
| `/tasks` | 全站任务监控（筛 type/status/user + 错误码前端过滤），详情含输入图/产物缩略图；取消（queued）、强制失败（running）、重新入队（failed） |
| `/gallery` | 画廊审核：大图预览，通过/拒绝（填原因）/下架 |
| `/content` | 公告 CRUD + 更新说明 CRUD 两个 Tab |
| `/audit` | 审计日志分页（筛管理员邮箱 / path 关键字），行展开显示 detail JSON |
| `/settings` | 任务单价、任务模型（default + 按类型覆盖）、用户并发上限、注册开关、注册赠送金额；测试 chatgpt2api 连通 |

## 约定

- 金额：接口一律整数「分」（`*Cents`），界面一律「元」，转换集中在 `src/utils.ts`（`fenToYuan` / `yuanToFen`）。
- 请求：全部走 `src/request.ts` 的 `request()`（`credentials: 'include'`、统一 `{success,data}` 解包、401 跳登录、错误码中文 toast）。
- 分页：契约为 cursor 分页，列表页用「上一页/下一页」（历史 cursor 栈实现上一页）。
- 图表：echarts 按需注册（`echarts/core` + Line/Bar/Pie + Grid/Tooltip/Legend + CanvasRenderer），统一包装在 `src/components/EChart.vue`；随仪表盘/财务页路由懒加载，不进入首屏包。

## 契约中未明确、按假定实现的字段（后端如不同请对齐）

契约 v2「后台接口字段补充定义」已明确 stats / users / tasks / settings / active 等字段，以下为剩余假定：

1. `GET /api/admin/users` 列表项假定含 `balanceCents`（缺失显示 `-`）。
2. 账本 `kind` / `sourceType` 契约未穷举枚举值：财务页筛选用自由文本输入；`src/utils.ts` 的 `LEDGER_KIND_LABELS` 只映射常见值，未知 kind 原样展示。
3. `GET /api/admin/finance/summary` 的 `revenueDaily` / `spendDaily` 假定可能不含零值日期：双折线按两组日期并集对齐、缺失补 0。
4. 任务详情输入图直接 `img src="/api/files/{key}"`：假定管理员可读任意用户的 `uploads/` 前缀（契约写的是"属主校验"，若后端未对 admin 放行则图片会 403）。
5. `GET /api/admin/audit-logs` 的 `detail` 兼容对象与 JSON 字符串两种形状。
6. `settings.taskModels`：`default` 必填，类型覆盖留空时不写入该 key（运行时回落 default）。
7. 任务监控的"错误码"筛选为纯前端过滤（仅当前页），契约暂无 `?errorCode=` 参数。
8. 订单/任务列表项中的用户与套餐信息兼容 `userEmail` / `user.email` / `userId`、`planName` / `plan.name` 多种形状。
