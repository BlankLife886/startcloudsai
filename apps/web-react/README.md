# React 主站

这个应用是生产用户端主站。源码、样式、静态资源和测试均位于 `apps/web-react`；智能画布源码已合并到 `src/canvas`，主站可独立安装、构建和运行。

```bash
npm install
npm run dev
```

开发入口为 `http://127.0.0.1:3105/`，`/api` 默认代理到 `http://localhost:8000`。

生产镜像构建：

```bash
docker build -f apps/web-react/Dockerfile -t startcloudsai-web-react:test .
```

完整本地服务使用默认 Compose：

```bash
docker compose --env-file .env up -d --build
```

交互与视觉回归：

```bash
npm run test:domain
npm run test:e2e
npx playwright test --grep @visual --project visual-desktop --project visual-mobile --grep-invert 'Ecommerce Vue to React visual contract'
npx playwright test tests/e2e/ecommerce-migration-visual.spec.js --project visual-desktop
```
