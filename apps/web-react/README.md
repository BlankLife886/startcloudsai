# React 主站

这个应用是完成迁移后的 React 用户端主站。开发模式继续使用独立端口，生产容器需要从仓库根目录构建，因为编译过程会读取 `apps/web` 和 `apps/canvas-react` 的共享源码。

```bash
npm install
npm run dev
```

开发入口为 `http://127.0.0.1:3105/`。共享静态资源来自 `apps/web/public`，智能画布直接复用 `apps/canvas-react`。

生产镜像构建：

```bash
docker build -f apps/web-react/Dockerfile -t startcloudsai-web-react:test .
```

解除旧项目源码依赖期间，默认 Compose 继续使用 Vue 主站。测试 React 主站时显式叠加覆盖文件：

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.react.yml --env-file .env up -d --build
```
