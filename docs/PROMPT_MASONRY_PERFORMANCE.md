# 全站图片加载与瀑布流滚动性能方案

本文说明用户端 `/prompts` 页面如何同时实现以下目标：

- 横图、方图、竖图和长海报按照原始比例完整显示，不使用统一比例裁切。
- 图片加载前尽可能预留准确高度，避免布局跳动。
- 内容持续分页后，DOM 数量不会随数据总量线性增长。
- 历史远程封面没有尺寸元数据时能够立即显示，并由后端渐进补齐。
- 远程图片探测不绕过 SSRF、响应大小和解码像素限制。

本文同时定义全站图片页面的统一接入方式。提示词页是尺寸元数据和虚拟瀑布流的完整参考实现；创作历史、个人中心、文生图、游戏美术、模型设定图、投稿列表和普通内容卡片按下文的分级策略复用同一套原则。

## 设计原则

简单的 CSS `column-count` 只能实现瀑布流外观。它会把全部卡片长期保留在 DOM 中，也无法在图片下载前可靠知道卡片高度。长列表需要把图片管线和布局管线一起设计：

1. 后端保存并返回图片宽高。
2. 前端根据宽高预先计算卡片位置。
3. 只挂载视口附近的卡片。
4. 历史数据缺少宽高时使用非阻塞降级，而不是阻塞接口批量下载图片。
5. Worker 在后台逐步把降级数据转为稳定元数据。

## 完整数据流

```text
后台上传 / 画廊转提示词
        |
        v
Go 解码图片头，得到 width / height
        |
        v
prompt_library.cover_width / cover_height
        |
        v
GET /api/v1/prompts 返回 coverWidth / coverHeight
        |
        v
前端计算每张卡片的 top / left / mediaHeight
        |
        v
只渲染视口上下缓冲区内的卡片
```

历史远程 URL 采用另一条非阻塞路径：

```text
API 首次返回 coverWidth=null / coverHeight=null
        |                              |
        |                              +--> 浏览器图片加载后读取 naturalWidth/naturalHeight
        |                                   同一动画帧批量更新布局，立即完整显示
        v
Worker 每 10 分钟领取 24 张缺少尺寸的远程封面
        |
        v
安全下载并解析图片头，写回数据库
        |
        v
后续请求直接获得稳定尺寸，不再依赖客户端测量
```

## 数据库模型

迁移：`apps/server/migrations/00027_prompt_cover_dimensions.sql`。

`prompt_library` 新增字段：

| 字段                        | 类型               | 说明                     |
| --------------------------- | ------------------ | ------------------------ |
| `cover_width`               | `integer NULL`     | 封面原始像素宽度         |
| `cover_height`              | `integer NULL`     | 封面原始像素高度         |
| `cover_metadata_checked_at` | `timestamptz NULL` | 最近一次远程尺寸探测时间 |

约束要求宽高必须同时为空，或同时为正整数，避免只保存单边尺寸。尺寸为空是合法的过渡状态，主要用于迁移前历史数据、刚同步的远程 URL 和暂时无法访问的源站图片。

当同步数据源更换某条词条的 `cover_key` 时，store 会同时清空旧宽高和检查时间，防止新 URL 复用旧图片比例。

## API 契约

公开和管理端提示词对象均包含：

```json
{
  "id": "uuid",
  "title": "提示词标题",
  "prompt": "提示词正文",
  "coverUrl": "https://example.com/cover.jpg",
  "coverWidth": 1200,
  "coverHeight": 800
}
```

没有可靠元数据时 `coverWidth`、`coverHeight` 为 `null`。客户端不得把 `null`、`0` 或单边尺寸当作有效比例。

后台封面上传成功响应额外返回：

```json
{
  "coverUrl": "/api/v1/files/prompt-covers/example.webp",
  "coverWidth": 1200,
  "coverHeight": 800
}
```

## 后端写入路径

### 后台直接上传

`adminUploadPromptCover` 在上传 R2 之前完成以下校验：

1. multipart 文件不超过 8 MiB。
2. 魔数必须为 PNG、JPEG 或 WebP。
3. `media.Dimensions` 使用图片解码器读取宽高。
4. 宽高必须为正，解码像素总数不得超过 `40,000,000`。
5. R2 上传成功后，`cover_key`、宽高和检查时间一起写入数据库。

如果对象上传后数据库更新失败，新对象会被删除；旧封面在新对象和数据库都成功后才删除。

### 画廊作品转提示词

该路径先从 R2 读取选中的投稿图片或缩略图，执行相同格式和尺寸校验，再复制到 `prompt-covers/`。新提示词写入失败时会同时清理数据库记录和复制出的对象。

### 外部提示词源同步

JSON、Markdown 和 HTML 数据源通常只提供远程图片 URL。同步过程不阻塞下载所有图片，只保存 URL：

- URL 未变化：保留已有宽高。
- URL 变化：清空宽高，等待后台回填。
- 新词条：宽高初始为空。

这样一次包含上千条数据的提示词同步不会被图片源速度放大成超长事务。

## 历史尺寸回填

Asynq 周期任务 `cron:backfill_prompt_cover_dimensions` 每 10 分钟执行一次：

- 每批最多 24 条。
- 最多 4 个远程请求并发。
- 只处理 `http://` 或 `https://` 且宽高缺失的封面。
- 单图响应上限 8 MiB。
- 请求通过 `netguard` 客户端，生产环境禁止私网地址、重定向到私网和 HTTPS 降级。
- 图片仍需通过格式、宽高和 4000 万解码像素限制。
- 成功后写入宽高及 `cover_metadata_checked_at`。
- 失败后只更新时间戳，24 小时后才允许再次尝试。

以 1713 张历史远程封面估算，在全部可访问且 Worker 持续运行时，单 Worker 约 12 小时完成第一轮。回填不阻塞 API，也不影响前端立即使用自然尺寸。

新上传的站内封面无需等待回填。迁移前已经存在的站内 R2 封面如果缺少尺寸，会继续使用客户端测量；当前后台任务只主动抓取远程 URL。

## 前端虚拟瀑布流（历史 Vue 实现）

以下路径记录迁移前的 Vue 实现，仅用于追溯性能方案；当前生产用户端位于
`apps/web-react`，旧路径已随 Vue 主站下线而删除。

历史实现：`apps/web/src/features/creator-hub/useVirtualMasonryFeed.js`。

### 布局计算

当前默认参数：

| 参数             | 值       | 说明                           |
| ---------------- | -------- | ------------------------------ |
| `gap`            | `14px`   | 卡片水平和垂直间距             |
| `minColumnWidth` | `220px`  | 自动增加列数时的最小列宽       |
| `maxColumns`     | `4`      | 桌面端最大列数                 |
| `bodyHeight`     | `178px`  | 标题、正文和操作区的稳定高度   |
| `overscan`       | `960px`  | 视口上下额外挂载范围           |
| 分页预取距离     | `1200px` | 距离列表底部多远开始请求下一页 |

列数计算：

```text
columns = clamp(
  floor((containerWidth + gap) / (minColumnWidth + gap)),
  1,
  maxColumns
)
```

媒体高度计算：

```text
aspect = coverWidth / coverHeight
mediaHeight = (columnWidth - cardBorders) / aspect
cardHeight = mediaHeight + bodyHeight + cardBorders
```

卡片依次放入当前累计高度最小的列。最终通过绝对定位和 `translate3d(x, y, 0)` 放置，不在滚动事件中逐卡读取 DOM 尺寸。

为避免异常元数据制造无限高或无限宽的卡片，布局比例限制在 `1:5` 至 `5:1`。正常横图、方图、竖图以及常见长海报都按真实比例显示；超过范围的极端图片使用 `object-fit: contain` 保证内容不被裁掉。

### 虚拟化

布局会为全部数据计算轻量位置对象，但 Vue 只渲染满足以下条件的条目：

```text
cardBottom >= viewportTop - overscan
cardTop    <= viewportBottom + overscan
```

滚动监听使用 `{ passive: true }`，并通过 `requestAnimationFrame` 合并为每帧最多一次视口计算。容器宽度由 `ResizeObserver` 监听。离开虚拟范围的卡片会从 DOM 移除，但数据、位置和浏览器图片缓存仍保留。

因此 DOM 数量主要由视口高度决定，而不是已经加载的提示词总数决定。

## 无尺寸数据的客户端降级

API 宽高为空时，首帧使用稳定的 `3:4` 占位比例。图片加载事件读取 `naturalWidth` 和 `naturalHeight`，然后：

1. 按条目 key 缓存比例。
2. 同一个动画帧内合并多张图片的测量结果。
3. 重新计算各列位置和容器总高度。
4. 保持虚拟范围和下一页 sentinel 同步。

该过程只用于历史过渡。后端尺寸回填后，同一图片在后续请求中会在下载前获得准确高度。

## 图片加载策略

- 首屏约两行图片使用 `loading="eager"`。
- 第一行图片使用较高 `fetchpriority`。
- 其余图片使用 `loading="lazy"`、低请求优先级和 `decoding="async"`。
- DOM 本身提前挂载约 960px，浏览器可以在图片进入视口前开始加载。
- `<img>` 写入计算后的 `width`、`height`，为浏览器提供稳定布局提示。
- 图片使用 `object-fit: contain`，不裁切原始内容。
- 下一页在列表底部前 1200px 触发，降低快速滚动时等待概率。

## 全站接入方案

### 图片组件分层

不要让业务页面自行实现鉴权、懒加载、重试和占位。按媒体来源选用以下组件：

| 场景                       | 组件                                | 行为                                                         |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| 公开 URL、品牌图、投稿封面 | `OptimizedImage.vue`                | 交叉观察器提前激活、骨架占位、异步解码、失败重试、宽高事件   |
| 站内鉴权媒体               | `AuthenticatedImage.vue`            | 延迟取 Blob、对象 URL 生命周期管理、缓存、重试、最大解码边长 |
| 同时具有缩略图和原图       | `ProgressiveAuthenticatedImage.vue` | 先显示缩略图；只有详情或明确传入 `load-original` 时叠加原图  |

所有组件都接受 `width`、`height`，并在图片解码后发送 `dimensions`。业务数据已有可靠宽高时必须直接传入；没有宽高时使用稳定的业务默认比例，再把自然尺寸写入页面内存缓存，避免同一会话反复跳动。

### 原图和缩略图契约

任务接口同时返回 `thumbnailUrls` 和 `originalUrls`。使用规则是：

```text
列表 / 卡片 / 胶片条  -> thumbnailUrls
画布 / 全屏详情       -> originalUrls（先显示 thumbnailUrls）
下载 / 编辑 / 再创作  -> originalUrls
```

`useCreativeImageJob` 的 `outputs` 继续保存原图 URL，避免破坏下载、编辑、分组和任务映射；`outputPreviewUrls[originalUrl]` 保存对应缩略图。游戏美术和模型设定图的历史卡片、胶片条只读取 `outputPreviewUrls`，中央画布仍读取 `outputs`。删除任务时两个映射必须一起清理。

后端没有生成 `thumbnailKeys` 时，前端允许回退原图，但不得把“空的 `thumbnailKeys`”误判为已有缩略图。该降级保证旧任务可见，不应成为新任务的常态。

### 页面分级

| 页面类型                | 策略                                                      | 当前接入                                             |
| ----------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| 页面级无限瀑布流        | 确定性布局、视口虚拟化、提前分页                          | 提示词库、创作历史                                   |
| 工作台内嵌历史/资产列表 | 服务端游标分页、缩略图、`content-visibility` 跳过离屏渲染 | 文生图、游戏美术、模型设定图、插画染色素材抽屉       |
| 有界内容列表            | 共享图片组件、稳定尺寸、浏览器懒加载                      | 个人中心投稿/素材、工作室入口、广场                  |
| 编辑画布和全屏预览      | eager、高优先级、原图；保留固定画布尺寸                   | 壁纸预览、蒙版编辑、设计画布、拼图画布、助手大图查看 |

内嵌抽屉不能直接使用当前面向 window 滚动的 `useVirtualMasonryFeed`。这些区域先通过服务端游标限制单次数据量，再用 `content-visibility: auto` 与 `contain-intrinsic-size` 跳过离屏布局和绘制。如果单个抽屉需要长期承载数千张图片，应为 composable 增加显式滚动根节点后再改为真正虚拟化，不能仅继续增大分页批量。

### 加载优先级

- 首屏主视觉、当前编辑对象：`loading="eager"`、`fetchpriority="high"`、`decoding="async"`。
- 首屏卡片：可以 eager，但只允许前一至两行；其余保持 lazy。
- 长列表卡片：观察器 `rootMargin` 建议 `480px` 至 `960px`，分页预取距离应大于图片激活距离。
- Blob/Data URL：没有网络下载成本，但仍使用 `decoding="async"`，列表中的历史消息和素材继续 lazy，当前编辑引用使用 eager。
- Logo、头像等稳定小图写入明确 `width`、`height`，避免导航栏位移。

### 完整显示与裁切边界

完整检查图片内容的页面使用 `object-fit: contain`，例如提示词、任务历史、素材详情和全屏预览。只有产品明确要求统一视觉裁切的运营封面、头像、设备 mockup 才使用 `cover`。不能为了瀑布流整齐把不同尺寸的生成图强制裁成同一比例。

CSS 必须给固定格式区域稳定约束：瀑布流由宽高比计算媒体高度；头像、缩略图和工具栏使用固定宽高；画布使用 `aspect-ratio` 或稳定网格轨道。加载态、失败态和操作按钮不能改变卡片尺寸。

### 内存与 DOM 上限

全站性能验收同时检查三个数量，而不只看接口速度：

1. DOM 中图片卡片数量是否随总数据无限增长。
2. 已创建的 Blob URL 是否在离开缓存或组件卸载时释放。
3. 列表是否解码了远大于显示尺寸的原图。

页面级虚拟瀑布流的卡片 DOM 数量应主要由视口和 overscan 决定。工作台抽屉应由分页限制已加载数据，并通过离屏渲染跳过控制主线程成本。任何列表请求原图都应视为回归，除非后端明确没有可用缩略图。

## 一致性与失败边界

- 宽高不是安全授权字段，不参与文件访问判断；文件权限仍由 `/api/v1/files` 完成。
- 无宽高不会导致提示词不可见，只会进入客户端测量降级。
- 远程尺寸探测失败不会让周期任务整体失败，也不会清空封面 URL。
- 尺寸回填只更新对应提示词的元数据，不修改标题、prompt、分类、排序或运营状态。
- 数据源更换图片 URL 时主动失效旧尺寸。
- 删除提示词仍按原逻辑删除站内封面对象；远程 URL 不执行对象删除。

## 部署与迁移

生产部署需要同时重建并重启 API、Worker 和用户端：

```bash
docker compose --env-file .env up -d --build server worker web gateway
```

`server` 监听端口前自动执行 Goose `00027`。`worker` 在 `server` 健康后启动，因此不会在字段尚未创建时运行回填任务。

部署后检查：

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE cover_width IS NOT NULL AND cover_height IS NOT NULL) AS measured,
       count(*) FILTER (WHERE cover_key ~* '^https?://' AND cover_width IS NULL) AS remote_pending
FROM prompt_library
WHERE cover_key IS NOT NULL AND cover_key <> '';
```

查看后台回填日志：

```bash
docker compose logs -f worker
```

失败 URL 会出现 `prompt cover dimensions <id> failed`，并在 24 小时冷却后重试。

## 验证要求

代码检查：

```bash
cd apps/server
go vet ./...
go test ./...

cd ../web
npm run check:imports
npm run lint
npm run build

cd ../admin
npm run build
```

页面验证至少覆盖：

- `1280x720` 与 `1440x900` 桌面视口下的稳定列布局；不验收移动端列数。
- 横图、方图、竖图、约 1:3 长图。
- 图片内容无裁切。
- 卡片矩形不重叠。
- 快速滚动后 DOM 卡片数量仍受虚拟范围约束。
- 加载下一页后容器高度增长，当前滚动位置不跳回顶部。
- 图片加载失败时卡片结构和操作按钮仍稳定。

当前自动化验证样本中，首屏同时出现 10 种媒体高度；自然宽高比与渲染宽高比最大误差约 `0.004`，未检测到卡片重叠。

## 关键实现文件

- 数据库迁移：`apps/server/migrations/00027_prompt_cover_dimensions.sql`
- 数据模型与查询：`apps/server/internal/store/models.go`、`promptlibrary.go`
- 同步 URL 失效处理：`apps/server/internal/store/promptsources.go`
- 图片尺寸解析：`apps/server/internal/media/image.go`
- 上传与画廊转换：`apps/server/internal/httpapi/handlers_community.go`
- API 序列化：`apps/server/internal/httpapi/serialize.go`
- 历史回填：`apps/server/internal/promptsync/sync.go`
- Worker 调度：`apps/server/internal/worker/worker.go`
- 历史 Vue 用户端数据适配：`apps/web/src/services/promptsApi.js`、`promptLibrary.js`
- 历史 Vue 虚拟瀑布流：`apps/web/src/features/creator-hub/useVirtualMasonryFeed.js`
- 历史 Vue 共享图片组件：`apps/web/src/components/common/OptimizedImage.vue`、`AuthenticatedImage.vue`、`ProgressiveAuthenticatedImage.vue`
- 历史 Vue 原图/缩略图映射：`apps/web/src/features/creative-studios/useCreativeImageJob.js`
- 历史 Vue 页面接入：`apps/web/src/views/PromptLibraryView.vue`、`CreationHistoryView.vue`、`GameArtStudioView.vue`、`ModelSheetStudioView.vue`
- 历史 Vue 卡片样式：`apps/web/src/features/creator-hub/creator-hub.css`

## 调整参数时的判断顺序

出现滚动空白时，先增加 `overscan` 或分页预取距离；出现网络突发时，减少 eager 数量或回填批量；出现内存上涨时，先检查 DOM 卡片数量和图片解码尺寸，不要直接缩小原图显示比例。任何调参都需要比较受支持的桌面视口、快速滚动和弱网场景；移动端不属于验收范围。
