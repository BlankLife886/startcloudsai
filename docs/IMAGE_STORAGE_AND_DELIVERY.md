# 图片目录、上传、存储与下载全链路

本文按当前代码说明 StarCloudsAI 中图片放在哪里、从哪里上传、从哪里下载、数据库记录什么，以及删除后如何清理。本文同时区分：

- 随代码发布的静态图片。
- 用户上传和 AI 生成的运行时图片。
- 浏览器本地临时图片。
- ChatGPT2API 上游运行数据。

本文不记录任何 AccessKey、Secret 或线上实际凭据。

## 1. 先说结论

1. 用户上传和 AI 生成图片不存放在 API/Worker 容器的项目目录中。
2. 生产环境的最终图片存放在 `OBJECT_STORAGE_BUCKET` 指定的私有 OSS Bucket。
3. 本地集成环境使用 MinIO 模拟 OSS，Bucket 为 `startcloudsai-local`，数据在 Docker Volume 中。
4. PostgreSQL 不保存图片二进制，只保存对象 Key、业务归属、引用关系和元数据。
5. 用户正常查看和下载图片都经过站内 `/api/v1/files/{key}`，不会直接暴露 OSS 凭据。
6. 无限画布正常上传后也进入 OSS/MinIO；只有网络上传失败时才会暂存在浏览器 IndexedDB。
7. ChatGPT2API 自己还有 `/app/data` 运行目录，但主站收到上游结果后会重新保存到主站 OSS。不能把 ChatGPT2API 的数据卷当成主站最终图片库。

## 2. 完整数据流

```text
用户选择、拖入或粘贴图片
        |
        v
浏览器读取 File/Blob
        |
        v
POST /api/v1/uploads
        |
        v
Go API 校验大小、文件签名、安全规则和图片尺寸
        |
        +--> 保存原图
        +--> 生成并保存小图
        +--> 生成并保存展示图
        |
        v
私有 OSS / 本地 MinIO
        |
        v
PostgreSQL 保存对象 Key 和业务引用
        |
        v
任务把 inputKeys 交给 Worker
        |
        v
Worker 从 OSS 读取参考图并发送给上游
        |
        v
ChatGPT2API/其他上游生成图片，返回 base64 或远程 URL
        |
        v
Worker 拉回图片、处理并重新保存原图/小图/展示图到 OSS
        |
        v
tasks.output_keys / thumbnail_keys 保存最终 Key
        |
        v
浏览器 GET /api/v1/files/{key} 查看或下载
```

## 3. “文件夹”实际是什么

OSS/S3/MinIO 使用对象 Key，不是真正的 Linux 文件夹。例如：

```text
uploads/用户ID/original/文件ID.png
```

在 OSS 控制台中看起来像多级目录，但实际是一个完整 Key。代码通过前缀区分归属和用途。

## 4. 所有运行时对象 Key

### 4.1 用户直接上传

入口：

- 用户端：`POST /api/v1/uploads`
- 开放 API：`POST /api/open/v1/uploads`
- 表单字段：`file`
- 单文件上限：15 MB
- 图片格式：PNG、JPEG、WebP
- 同一个上传接口也支持受控的视频和音频格式。

图片上传成功后最多保存三份：

| 用途 | Key 格式 | 说明 |
| --- | --- | --- |
| 原图 | `uploads/{userId}/original/{fileId}.{ext}` | 保留用户上传的原始内容 |
| 小图 | `uploads/{userId}/thumb/{fileId}` | 列表、历史、侧边栏优先使用 |
| 展示图 | `uploads/{userId}/display/{fileId}` | 大图预览优先使用 |

小图和展示图故意不带扩展名，真实格式从 OSS 对象的 `Content-Type` 读取。后台可以切换变体编码格式，而不用修改历史 Key。

默认变体配置：

- 小图最长边默认 512 px，质量 75。
- 展示图最长边默认 2048 px，默认质量 85。
- 默认编码为 WebP；可由后台图片配置调整。
- 原图不会因生成变体而被替换。
- 展示图生成失败不会阻止上传，前端会回退原图。

### 4.2 普通 AI 图片任务

适用于文生图、插画染色、UI 设计、AI 电商、模型图、游戏美术、拼图、背景移除、媒体工具和无限画布发起的普通图片任务。

| 用途 | Key 格式 |
| --- | --- |
| 原图 | `tasks/{userId}/{taskId}/original/{index-or-attempt}.{ext}` |
| 小图 | `tasks/{userId}/{taskId}/thumb/{index-or-attempt}` |
| 展示图 | `tasks/{userId}/{taskId}/display/{index-or-attempt}` |

`index-or-attempt` 可能包含完成声明 ID 或 Worker 租约标识。这样旧 Worker 即使晚到，也不能覆盖重试成功后的最终图片。

对应数据库字段：

- `tasks.input_keys`：任务使用的上传图片 Key。
- `tasks.output_keys`：最终原图 Key。
- `tasks.thumbnail_keys`：最终小图 Key。
- 展示图 Key 不单独入库，由原图 Key 中的 `/original/` 推导为 `/display/`。

### 4.3 AI 助手生成图片

AI 助手使用独立 Key 结构：

| 用途 | Key 格式 |
| --- | --- |
| 原图 | `tasks/{userId}/assistant/{runId}/{number}.{ext}` |
| 小图 | `tasks/{userId}/assistant/{runId}/{number}-thumb` |
| 展示图 | `tasks/{userId}/assistant/{runId}/{number}-display` |
| CRUN 临时输入 | `tasks/{userId}/assistant/{runId}/crun-input/{number}.{ext}` |

助手消息在 `assistant_messages.metadata` 中保存 `fileKey`、`dataUrl`、`thumbUrl` 和 `displayUrl`，图片本体仍在 OSS。

### 4.4 AI 助手上传文档和生成文件

AI 助手文档入口：`POST /api/v1/assistant/files`。

上传的 TXT、Markdown、CSV、JSON、PDF、DOCX、XLSX、PPTX 等文件，以及助手生成的 PPT、PSD、ZIP 或其他可下载产物，都复用：

```text
uploads/{userId}/original/{artifactId}.{ext}
```

这些不一定是图片，但与图片共用对象存储和下载接口。元数据分别记录在 `assistant_files` 或 `assistant_messages.metadata.artifacts` 中。

下载地址格式：

```text
/api/v1/files/{key}?download=1&name={文件名}
```

### 4.5 个人资产库 DAM

资产库不会再次自动复制普通上传图片。它主要把已有上传对象登记为可管理资产：

- 原图必须来自 `uploads/{userId}/original/`。
- 小图必须来自 `uploads/{userId}/thumb/`。
- `user_assets.file_key` 保存原图 Key。
- `user_assets.thumbnail_key` 保存小图 Key。
- 标签、分组、内容哈希、来源和派生关系保存在数据库。

AI 电商手持商品图保存到资产库时会复制成：

```text
uploads/{userId}/original/handheld-{itemId}.{ext}
uploads/{userId}/thumb/handheld-{itemId}.{ext}
```

### 4.6 用户头像和创作台人物图

头像和创作台人物图使用用户自己的 `uploads/{userId}/...` 对象。人物图如果原本来自任务结果，会复制到用户上传区，并补齐小图和展示图，使其不依赖原任务是否保留。

数据库引用位置：

- `users.avatar_url`
- `users.studio_figure_url`
- `user_upload_references`

### 4.7 提示词封面

```text
prompt-covers/{promptId}/{uuid}.{ext}
prompt-covers/import-{importItemId}/{uuid}.{ext}
```

提示词封面是纯展示素材，上传时最长边压到 1280 px，不另外保留原始大图。Key 记录在 `prompt_library.cover_key` 或导入暂存表中。

### 4.8 公告图片

```text
announcement-images/{uuid}.{ext}
```

公告图片同样按展示图规则压缩后保存，不额外保留上传前原图。

### 4.9 AI 电商后台通用素材

当前后台商品/模特/场景目录的实际写入前缀为：

```text
ecommerce-catalog/{catalogItemId}/{uuid}.{ext}
```

Key 存在电商目录表的 `image_key` 中。

文件接口仍识别 `ecommerce-tryon/` 和 `ecommerce-handheld/` 作为兼容公开前缀，但当前主要写入逻辑使用 `ecommerce-catalog/`、`uploads/` 和普通 `tasks/`。

### 4.10 画布模板封面和内嵌资源

```text
canvas-template-covers/{templateId}/{uuid}.{ext}
canvas-template-assets/{templateId}/{contentHash}.{ext}
```

- 模板封面 Key 存在 `canvas_workflow_templates.cover_key`。
- 模板内嵌图片按内容哈希命名，模板 JSON 中保存对应 Key/URL。
- 模板更新时会扫描该模板前缀并删除不再使用的资源。
- 当前用户端工作流产品化入口已撤下，但数据库迁移和兼容代码仍保留。

### 4.11 外部远程图片例外

并非数据库中的每个图片字段都一定是 OSS Key。历史提示词、远程提示词数据源和部分运营配置可能保存完整的 `http://` 或 `https://` 图片地址：

- `prompt_library.cover_key` 可以是待审核的外部封面 URL。
- 远程提示词导入暂存项可以先保留外部封面地址。
- 公告配置中的普通链接素材可以是经过校验的外部 URL；通过后台“上传图片”产生的图片才位于 `announcement-images/`。

这类图片由页面直接向外部来源读取，不在主站 OSS，也不受主站对象清理队列管理。正式迁移前应单独检查并决定是否转存到 OSS，避免外部源失效后页面缺图。

## 5. 哪些图片允许公开读取

`/api/v1/files/{key}` 在返回 OSS 内容前执行权限判断。

默认公开业务前缀：

- `prompt-covers/`
- `canvas-template-covers/`
- `canvas-template-assets/`
- `announcement-images/`
- `ecommerce-catalog/`
- 兼容前缀 `ecommerce-tryon/`、`ecommerce-handheld/`

默认私有：

- `uploads/{userId}/`
- `tasks/{userId}/`

私有文件只允许文件属主或管理员读取。已审核通过的画廊投稿图片可以通过数据库公开关系读取。头像允许已登录用户读取，但仍不开放匿名外链。

## 6. 图片从哪里下载

### 6.1 用户查看图片

用户端访问：

```text
GET /api/v1/files/{objectKey}
```

开放 API 访问：

```text
GET /api/open/v1/files/{objectKey}
```

管理后台访问：

```text
GET /api/v1/admin/files/{objectKey}
```

Go API 校验权限后，从 OSS/MinIO 流式读取并返回，支持：

- Range 分段读取。
- ETag 和 304。
- 私有缓存头。
- 自定义下载文件名。
- 对象存储首字节耗时 `Server-Timing`。

### 6.2 用户点击“下载”

前端一般先通过站内文件接口取得 Blob，再创建临时 `blob:` URL 触发浏览器下载。最终文件进入用户浏览器设置的下载目录，通常是电脑的“下载”文件夹；服务器不会再创建一份“用户下载副本”。

也可以使用：

```text
GET /api/v1/files/{objectKey}?download=1&name=指定文件名.png
```

### 6.3 Worker 从哪里取得参考图

Worker 根据 `tasks.input_keys` 从同一个 OSS Bucket 读取 `uploads/...` 对象，转换为上游需要的 base64 或预签名 URL，再发送给模型服务商。

`OBJECT_STORAGE_ENDPOINT` 用于 Server/Worker 读写。生产同地域时应使用 OSS 内网 Endpoint，减少公网流量和延迟。

`OBJECT_STORAGE_PUBLIC_ENDPOINT` 只用于确实需要让上游访问的预签名 URL，不是普通用户查看图片的地址。

### 6.4 Worker 从哪里取得上游生成结果

上游可能返回：

- `b64_json` 图片内容。
- 上游远程图片 URL。
- 异步图片任务的最终结果列表。

主站 C2A 客户端或 Worker 会下载/解码上游结果，验证大小、格式和尺寸，然后重新保存到主站 OSS 的 `tasks/...`。因此用户最终读取的是主站 OSS 副本，不依赖上游图片链接长期有效。

## 7. 生产 OSS 的物理位置

生产最终位置由以下环境变量决定：

```env
OBJECT_STORAGE_ENDPOINT=...
OBJECT_STORAGE_PUBLIC_ENDPOINT=...
OBJECT_STORAGE_REGION=...
OBJECT_STORAGE_BUCKET=...
OBJECT_STORAGE_USE_PATH_STYLE=false
OBJECT_STORAGE_PRESIGN_EXPIRE_SECS=3600
```

当前部署方案使用阿里云 OSS S3 兼容接口，Bucket 必须保持私有。Bucket 名没有硬编码在业务代码中，以生产 `.env` 中的 `OBJECT_STORAGE_BUCKET` 为准。如果生产配置为用户此前确定的 `starcloudisai-prod-oss`，上述所有前缀都位于该 Bucket 内。

生产服务器本地磁盘不会出现 `uploads/` 或 `tasks/` 实体目录。它们在 OSS Bucket 中。

## 8. 本地 Docker/MinIO 的物理位置

本地集成编排使用：

```text
Bucket: startcloudsai-local
容器内数据目录: /data
Compose Volume: minio_local_data
当前 Docker 实际 Volume: startcloudsai-integrated_minio_local_data
```

相关配置文件：

- `deploy/integrated/docker-compose.local-storage.yml`
- `deploy/integrated/local-compose.sh`

Docker Desktop 管理宿主机上的 Volume 实际目录，不属于 Git 仓库。需要查看物理挂载信息时使用：

```bash
docker volume inspect startcloudsai-integrated_minio_local_data
```

不要手工修改 Volume 内部文件，也不要在需要保留本地图片时执行带 `-v` 的 Compose 删除命令。

源码模式不会自动把图片写入项目文件夹；它使用当前 `.env` 配置的对象存储。

## 9. 无限画布的额外浏览器存储

无限画布优先把图片上传到 `/api/v1/uploads`。如果上传发生网络错误，会使用浏览器本地兜底：

```text
IndexedDB 数据库: infinite-canvas
Object Store: image_files
本地 Key: image:{nanoid}
```

这些图片只存在当前浏览器用户数据中：

- 不在 PostgreSQL。
- 不在 OSS。
- 不会同步到其他电脑或浏览器。
- 清理浏览器站点数据后会丢失。
- 画布同步完成后应尽量使用 `uploads/` 或 `tasks/` 云端 Key。

页面运行期间还会创建 `blob:` URL 和内存图片缓存。它们只是浏览器临时预览，不是持久化文件。

## 10. ChatGPT2API 自己的图片与文件位置

集成 Compose 将 ChatGPT2API 的：

```text
/app/data
```

挂载到：

```text
Compose Volume: chatgpt2api_integrated_data
当前 Docker 实际 Volume: startcloudsai-integrated_chatgpt2api_integrated_data
```

ChatGPT2API 的主要运行文件包括：

| 位置 | 用途 |
| --- | --- |
| `/app/data/image_tasks.json` | 图片任务状态 |
| `/app/data/image_task_spool/` | 图片任务进程级临时落盘区 |
| `/app/data/images/` | ChatGPT2API 自有图片存储使用时的原图 |
| `/app/data/image_thumbnails/` | ChatGPT2API 自有缩略图 |
| `/app/data/image_index.json` | 图片索引和删除恢复状态 |
| `/app/data/files/ppt/{id}/` | PPT 主文件/素材包 |
| `/app/data/files/psd/{id}/` | PSD 主文件/素材包 |

在当前集成方案中，ChatGPT2API 的结构化数据使用独立 PostgreSQL 数据库，但 `/app/data` 仍承载图片任务状态、临时文件和可编辑文件。

主站取得图片或 PPT/PSD 后，会再次保存到主站 OSS。因此：

- 主站用户最终图片的事实来源是主站 OSS + 主站 PostgreSQL 引用。
- ChatGPT2API `/app/data` 是上游运行数据和阶段性副本。
- 迁移或排障时不能随意删除 ChatGPT2API 数据卷。

## 11. PostgreSQL 保存什么

PostgreSQL 只保存 Key、引用和元数据，不保存大图片二进制。

| 表/字段 | 保存内容 |
| --- | --- |
| `tasks.input_keys` | 任务参考图 Key |
| `tasks.output_keys` | 任务原图 Key |
| `tasks.thumbnail_keys` | 任务小图 Key |
| `user_upload_objects` | 用户上传对象、大小、归属和删除时间 |
| `user_upload_references` | 上传对象被任务、素材、头像、助手等业务引用的关系 |
| `user_assets.file_key` | 资产库原图 Key |
| `user_assets.thumbnail_key` | 资产库小图 Key |
| `assistant_messages.metadata` | 助手参考图、生成图和下载产物 Key/URL |
| `assistant_files.object_key` | 助手上传文档 Key |
| `gallery_submissions.cover_key/media_keys` | 投稿封面和媒体 Key |
| `prompt_library.cover_key` | 提示词封面 Key |
| `ecommerce_tryon_catalog.image_key` | 电商后台目录图片 Key |
| `canvas_workflow_templates.cover_key` | 画布模板封面 Key |
| `canvas_projects.document` | 画布节点中引用的图片 Key |
| `object_cleanup_jobs.object_key` | 等待从 OSS 删除的对象 Key |

数据库与 OSS 必须配套迁移。只有数据库没有 OSS，会出现记录存在但图片 404；只有 OSS 没有数据库，会留下无法归属和无法正常展示的孤儿对象。

## 12. 删除与自动清理

### 12.1 删除任务或助手图片

删除业务记录时不会在接口请求内大批量同步删除 OSS。系统先把 Key 写入 `object_cleanup_jobs`，Worker 再处理。

清理 Worker：

- 每 1 分钟检查一次清理队列。
- 有排队任务时暂停对象删除。
- 完全空闲时一批最多删除 100 个对象。
- 只有少量运行任务且工作量较低时，一批只删除 1 个对象。
- 高负载时暂停删除。
- OSS 删除失败后延迟 5 分钟重试。
- 删除前重新检查任务、助手、资产、画廊、提示词、画布等数据库引用。

普通任务删除时会同时加入原图、小图和推导出的展示图。AI 助手图片删除时会加入助手原图、`-thumb` 和 `-display`。

### 12.2 用户普通上传

`uploads/` 对象先登记到 `user_upload_objects`，业务使用时登记到 `user_upload_references`。

- 无引用上传保留 7 天。
- Worker 每小时扫描一次。
- 超过 7 天且仍无引用才会从 OSS 删除。
- 删除时持有数据库锁，防止刚被业务引用的对象被误删。

### 12.3 资产库回收站

- 普通删除只是进入回收站，不立刻删 OSS。
- 30 天内可以恢复。
- Worker 每 6 小时检查一次过期回收站。
- 有排队任务或运行任务较多时暂停清理。
- 永久删除后才移除引用并进入 OSS 清理队列。

### 12.4 后台封面和模板素材

后台替换提示词封面、模板封面等内容时，会在数据库更新成功后删除旧对象。模板内嵌资源按模板前缀扫描，只保留当前文档仍引用的对象。

## 13. 随代码发布的静态图片目录

这些图片属于前端代码，不进入 OSS，也不是用户数据。

### 13.1 React 用户端

直接以网站根路径发布：

```text
apps/web-react/public/
apps/web-react/public/brand/
apps/web-react/public/icons/
apps/web-react/public/sucai/
apps/web-react/public/ecommerce/
apps/web-react/public/game-art/
apps/web-react/public/incentives/
apps/web-react/public/failure-compensation/
apps/web-react/public/friend-group/
apps/web-react/public/suggestion-adoption/
apps/web-react/public/usage-plan/
apps/web-react/public/签到页面素材/
apps/web-react/public/assets/canvas-workflow-demo/
```

由源码 import、构建时进入带哈希资源包：

```text
apps/web-react/src/legacy-static/assets/ecommerce/
apps/web-react/src/legacy-static/assets/ecommerce/models/
apps/web-react/src/legacy-static/assets/ecommerce/scenes/
apps/web-react/src/legacy-static/assets/icons/
apps/web-react/src/legacy-static/assets/incentives/
```

构建输出：

```text
apps/web-react/dist/
apps/web-react/dist/assets/
```

`dist/` 是构建产物，可通过重新构建生成，不是运行时图片库。

### 13.2 Vue 管理后台

源码图片：

```text
apps/admin/src/assets/login/
apps/admin/src/assets/checkin/
```

构建输出：

```text
apps/admin/dist/
apps/admin/dist/assets/
```

### 13.3 移动端

业务图片：

```text
apps/mobile/assets/images/
```

应用图标和启动图：

```text
apps/mobile/android/app/src/main/res/mipmap-*/
apps/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/
apps/mobile/ios/Runner/Assets.xcassets/LaunchImage.imageset/
```

`apps/mobile/build/` 下的图片是移动端构建副本，不是源文件。

### 13.4 测试截图

```text
apps/web-react/tests/e2e/__screenshots__/
apps/web-react/tests/fixtures/
```

这些是视觉回归基线和测试输入，不是用户图片。不能因为它们是截图就随意删除，否则视觉测试会失去基准。

### 13.5 第三方和生成目录

`node_modules/` 中的 SVG/图片属于依赖包；`dist/` 和 `build/` 中的是构建副本。统计项目业务素材时应排除：

```text
**/node_modules/**
**/dist/**
**/build/**
```

## 14. 临时目录

API 和 Worker 容器是只读文件系统，只开放 `/tmp` 临时文件系统。OCR 处理会短暂使用：

```text
/tmp/assistant-image-ocr-*/
/tmp/assistant-ocr-*/
```

这些目录在处理结束后删除，容器重启也会消失，不能作为图片存储或备份来源。

ChatGPT2API 的 `image_task_spool/` 位于持久卷内，但仍是任务级临时区域，由 ChatGPT2API 自己管理。

## 15. 迁移时必须带走什么

迁移到新服务器时，图片相关数据至少包括：

1. 主站 PostgreSQL 全量数据。
2. 生产 `OBJECT_STORAGE_BUCKET` 中的全部对象。
3. ChatGPT2API 独立 PostgreSQL 数据库。
4. ChatGPT2API `/app/data` 数据卷。
5. 生产环境变量中的对象存储 Endpoint、Region 和 Bucket 名；密钥应在新环境安全重配，不应写进迁移文档或代码包。

不需要迁移：

- 本地 MinIO 测试 Bucket。
- 浏览器 IndexedDB 临时画布图片。
- `/tmp` OCR 文件。
- `dist/`、`build/` 和 `node_modules/`，这些可以重新构建。

## 16. 不能直接手工删除的内容

不要直接在 OSS 控制台批量删除以下前缀，除非已经完成数据库引用审计：

```text
uploads/
tasks/
prompt-covers/
canvas-template-assets/
canvas-template-covers/
announcement-images/
ecommerce-catalog/
```

原因是一个图片可能同时被任务、助手、资产库、头像、画廊或画布引用。正确删除方式是通过业务接口，让系统移除引用并进入清理队列。

同样不要删除：

- `startcloudsai-integrated_minio_local_data`，除非确认不需要本地图片。
- `startcloudsai-integrated_chatgpt2api_integrated_data`，除非确认不需要上游任务和文件数据。
- 生产 OSS Bucket。

## 17. 代码位置索引

| 责任 | 代码位置 |
| --- | --- |
| 上传、文件权限和流式下载 | `apps/server/internal/httpapi/handlers_files.go` |
| OSS/S3/MinIO 读写 | `apps/server/internal/storage/object_storage.go` |
| 原图、小图、展示图 Key 推导 | `apps/server/internal/store/displaykeys.go` |
| 普通任务结果保存 | `apps/server/internal/worker/task_outputs.go` |
| AI 助手图片保存 | `apps/server/internal/worker/assistant.go` |
| AI 助手文件上传 | `apps/server/internal/httpapi/handlers_assistant_files.go` |
| PPT/PSD 等生成文件保存 | `apps/server/internal/assistanttools/artifacts.go` |
| 用户上传生命周期 | `apps/server/internal/store/uploads.go` |
| OSS 延迟清理队列 | `apps/server/internal/store/object_cleanup.go` |
| 清理 Worker | `apps/server/internal/worker/worker.go` |
| 资产库 | `apps/server/internal/httpapi/handlers_assets.go` |
| 创作台人物图持久化 | `apps/server/internal/userupload/studiofigure.go` |
| 公告图片上传 | `apps/server/internal/httpapi/handlers_admin.go` |
| 提示词封面和画廊封面 | `apps/server/internal/httpapi/handlers_community.go` |
| 提示词导入封面 | `apps/server/internal/httpapi/handlers_prompt_imports.go` |
| AI 电商目录图片 | `apps/server/internal/httpapi/handlers_ecommerce_catalog.go` |
| AI 电商手持图资产 | `apps/server/internal/httpapi/handlers_ecommerce_handheld.go` |
| 画布模板封面 | `apps/server/internal/httpapi/handlers_canvas_workflow_templates.go` |
| 画布模板内嵌资源 | `apps/server/internal/httpapi/canvas_template_assets.go` |
| 无限画布图片存储 | `apps/web-react/src/canvas/services/image-storage.ts` |
| 用户端上传 API 封装 | `apps/web-react/src/legacy-modules/services/tasksApi.js` |
| 用户端鉴权图片和下载 | `apps/web-react/src/legacy-modules/services/authenticatedMedia.js` |
| 本地 MinIO 编排 | `deploy/integrated/docker-compose.local-storage.yml` |
| 生产对象存储配置说明 | `docs/DEPLOYMENT.md` |
