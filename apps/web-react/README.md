# React 主站

这个应用是生产用户端主站。源码、样式、静态资源和测试均位于 `apps/web-react`；智能画布源码已合并到 `src/canvas`，主站可独立安装、构建和运行。

```bash
npm ci
npm run dev
```

上述 npm 命令在 `apps/web-react` 执行。开发入口为 `http://127.0.0.1:3105/`，`/api`、`/v1`、`/oauth` 和 `/.well-known` 默认代理到 `http://localhost:8000`；可通过进程环境变量 `VITE_API_PROXY_TARGET` 覆盖。

## 当前实现

代码核对日期：2026-09-22，以当前工作区为准，包含未提交变更。主站使用 React 19、Vite 7 与 React Router；桌面浏览器支持边界见 [桌面端策略](../../docs/DESKTOP_UI_POLICY.md)。独立 Flutter App 位于 `apps/mobile`。

- 路由定义：`src/router.jsx`；公共导航与访问控制：`src/layout/AppShell.jsx`、`src/config/pageControls.js`。
- `/canvas` 是画布入口，`/canvas/:id` 和 `/canvas/config` 为原生项目与配置路由；不再使用独立 iframe 服务。
- `/skills` 是真实技能库，支持本地、账号云端和官方技能，通过文生图、电商、助手及画布输入中的 `@` 提及使用，详见 [技能库](../../docs/SKILL_PAGE_PLAN.md)。
- 电商页面由 `EcommerceDesignView.jsx`、`EcommerceBusinessSession.jsx`、`features/ecommerce/workbench/` 与 `DetailStudio.jsx` 等组成；以当前工作台实现为准，迁移期组件和旧视觉描述不再是现状。
- `/assets` 为素材入口，`/materials` 保留重定向；另有 PSD 分解、闪光卡、工具目录、开发者 API 文档与控制台、订单与订阅页面。页面可见性仍受运行时页面控制影响。

`REACT_MIGRATION.md`、`DESIGN.md` 和 `CANVAS_CHANGELOG.md` 分别保留迁移记录、历史首页基线与上游版本历史，不作为当前完整功能清单。

生产镜像构建（以下 Docker 命令在仓库根目录执行）：

```bash
docker build -f apps/web-react/Dockerfile -t startcloudsai-web-react:test .
```

完整本地服务使用默认 Compose：

```bash
docker compose --env-file .env.development up -d --build
```

先按根 README 准备 `.env.development`。交互与视觉回归回到 `apps/web-react` 执行：

```bash
npm run test:domain
npm run build
npm run typecheck:canvas
npm run test:e2e -- --project chromium
npx playwright test --grep @visual --project visual-desktop
```

Playwright 会按配置启动或复用 `3105` 开发服务，可用 `WEB_BASE_URL` 指向其他实例。`visual-mobile` 和 `test:e2e:visual` 仍保留迁移期基线，后者会同时跑桌面与历史手机视口，不意味着新增手机 Web 支持承诺。领域测试不包含所有定向脚本；按改动补充 `test:canvas-workflow`、`test:canvas-storyboard`、`test:holo-card` 等。以上是验证命令，本次文档更新未据此宣称构建或测试通过。
