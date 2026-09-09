# 页面控制

后台入口为 `/admin/page-controls`（内容运营 → 页面控制）。当前共 51 项，可按分组、名称、路径或状态筛选，支持单页与整组调整。修改后点击“保存并生效”；下架需要再次确认。前台重新加载后读取最新配置。

| 状态 | 页面入口 | 访问效果 |
| --- | --- | --- |
| 正常开放 | 显示 | 正常访问 |
| 维护中 | 显示 | 展示维护说明 |
| 正在开发 | 显示 | 展示开发说明 |
| 页面移除 | 隐藏 | 历史链接也展示下架说明 |

非开放状态需填写用户可见的说明，最多 200 字。配置读取失败时不能保存，避免默认配置覆盖已有设置。

## 新增的 23 项控制

| 分组 | 页面 key | 页面 |
| --- | --- | --- |
| 开放能力 | `developer_api_docs` | API 文档 `/developer-api/docs` |
| 发现与内容 | `ai_tools` | 全部工具 `/ai-tools` |
| 发现与内容 | `prompts` | 提示词库 `/prompts` |
| 发现与内容 | `share` | 作品社区 `/share` |
| 发现与内容 | `app_space` | 关于我们 `/app-space` |
| 发现与内容 | `skills` | 技能库 `/skills` |
| 发现与内容 | `updates` | 更新日志 `/updates` |
| 发现与内容 | `feedback` | 问题反馈 `/feedback` |
| 核心创作 | `psd_decompose` | PSD 拆解 `/psd-decompose` |
| 核心创作 | `holo_card` | 全息卡片 `/holo-card`、样卡 `/holo-card/sample` |
| 图像工具 | `background_remove` | 智能抠图 `/tools/background-remove` |
| 图像工具 | `image_compress` | 图片压缩 `/tools/image-compress` |
| 图像工具 | `puzzle` | AI 拼图 `/tools/puzzle`、旧链接 `/ai-puzzle` |
| 图像工具 | `media_tools` | 其余模型工具 `/tools/:modelId` |
| 个人工作区 | `profile` | 个人中心 `/profile` |
| 个人工作区 | `history` | 我的作品 `/history` |
| 个人工作区 | `assets` | 素材库 `/assets`、旧链接 `/materials` |
| 个人工作区 | `submissions` | 我的投稿 `/submissions` |
| 个人工作区 | `notifications` | 消息通知 `/notifications` |
| 价格与账单 | `wallet` | 我的钱包 `/wallet` |
| 价格与账单 | `orders` | 我的订单 `/orders` |
| 价格与账单 | `subscriptions` | 我的订阅 `/subscriptions`、会员方案 `/incentive-plans/membership` |
| 活动入口 | `invitation` | 邀请返利 `/invite` |

新项目默认开放。原有默认值保持：插画染色与游戏设计为开发中，六个旧活动入口及开发者 API 控制台为下架。API 文档独立管理，控制台默认下架不影响文档阅读。

首页、登录、账户设置、隐私政策、用户协议、帮助页继续可访问。页面下架还会隐藏导航、首页卡片、个人工作区快捷入口及指向该页面的轮播/公告按钮。帮助页本身保留，反馈入口跟随反馈页面状态。

## 配置与发布

页面状态存放于现有 `page_controls` 设置，无需数据库迁移。后台设置接口和运行时配置接口都会把旧的部分配置与默认值合并，新增页面自动补齐，已保存的状态保留。后台页面控制提交完整配置，不改变其他系统设置。

发布时需同时更新管理端、用户端与 Go 服务；本地已运行的 Go 服务需重启以加载新增 key 白名单。页面控制用于页面入口和访问展示，功能 API 的权限、任务执行、订阅和订单处理仍遵循各自规则；它不替代 API 鉴权或业务停用设置。

相关实现：

- `apps/admin/src/views/PageControlsView.vue`：后台分组、状态与说明编辑。
- `apps/web-react/src/config/pageControls.js`：客户端 key、默认值、路由及别名映射。
- `apps/web-react/src/main.jsx`：全站统一的页面控制上下文，覆盖独立样卡和更新横幅。
- `apps/server/internal/settings/page_controls.go`：服务端白名单及默认值合并。

## 验证

```bash
cd apps/admin
npm run build

cd ../web-react
node --test scripts/test-page-controls.mjs
npm run build
ADMIN_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/admin-page-controls.spec.js tests/e2e/page-controls.spec.js tests/e2e/page-control-promotions.spec.js --project=chromium

cd ../server
go test ./internal/httpapi -run PageControl -count=1
```

后台浏览器测试需先启动管理端开发服务；接口由测试模拟，不修改真实页面状态。
