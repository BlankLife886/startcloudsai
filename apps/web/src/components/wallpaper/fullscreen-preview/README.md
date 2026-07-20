# 全屏壁纸预览

更新时间：2026-06-03

`WallpaperFullscreenPreview.vue` 是全屏预览弹窗的主壳，负责接收壁纸、组织工具栏和各功能面板。

目录约定：

- `constants/`：枚举、选项、固定比例和尺寸表。
- `api/`：全屏预览专用接口封装。
- `composables/`：跨功能共享状态和工具，例如当前处理后图片、canvas 安全图片加载。
- `features/`：按工具栏能力拆分的业务模块。

已落地的功能边界：

- `features/favorite/`：收藏状态同步、收藏/取消收藏和用户提示。
- `features/mockup/`：桌面/手机样机预览。
- `features/rotate/`：旋转角度状态。
- `features/display/`：铺满/完整显示偏好，以及预览图片标签、遮罩和跨域属性等展示派生状态。
- `features/info/`：壁纸信息面板，已继续拆成元数据区和用户内容区；系统标签和用户标签共用 `info-tags.css`，避免重复维护色彩规则。
- `features/compare/`：原图/处理后比较模式。
- `features/crop/`：裁切选择、应用裁切。
- `features/decompose/`：九宫格/自定义网格分解图片。
- `features/filters/`：基础滤镜、艺术风格、自定义预设和对比模式状态；历史栈、自定义预设、参数规范化、旧版滤镜映射、面板头部/标签页和三段面板 UI 已拆 helper/子组件。
- `features/ai/`：AI 图像处理面板、后台配置驱动的模型/输出尺寸/提示词、请求构造、图片 IO、尺寸校验、预算用量、输入调试、历史和配方。
- `features/download/`：下载弹窗数据衔接，处理后图片通过响应式 props 传递，不再依赖 DOM 属性桥接。
- `features/fullscreen/`：浏览器全屏 API。
- `features/loader/`：原图候选、详情加载、滤镜预览图构建和下载弹窗状态；图片来源、候选地址与 canvas 构建已拆 helper。
- `features/modes/`：裁切、样机、比较、分解、AI 面板之间的互斥切换协调。
- `features/shell/`：弹窗外壳状态、打开/关闭会话生命周期、全局滚动锁和资源清理。
- `features/toolbar/`：顶部工具栏 UI 和事件派发，已拆成主按钮组与集合翻页导航。
- `features/viewport/`：缩放、拖拽、小地图和几何约束装配层；缩放边界、可视源区域和焦点缩放计算已拆到 `previewZoomGeometry.js`。

维护原则：

- 主组件只做装配，不继续堆复杂业务。
- 每个工具能力先放到自己的 feature 目录，再按状态、UI、工具函数细拆。
- 复杂逻辑保留中文注释，说明“为什么这样做”，不注释显而易见的赋值。
