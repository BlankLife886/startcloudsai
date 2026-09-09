# 星间旅人 · 浮雕样卡

样卡页面：`/holo-card/sample`。它用于对照 RuiC 的真实分层、镭射与整卡构图，也是一套可直接用于自己图片的模板。展厅“制作同款”进入 `/holo-card?template=astral`；工作台与展厅共用分层渲染器和 `ASTRAL_TEMPLATE_SETTINGS`，自动提供相同的背景、光屑、排版和空间距离。

工作台选择有效透明 PNG 后可直接套用；普通照片经 image2 分离主体、检查并采用后自动完成。同一套真实示例人物通过用户上传入口制作、在相同视角导出时，应与展厅输出逐像素一致。不同图片保留自己的内容和细节，套用的是完整卡片版式与光效。

展示页采用午夜全屏舞台，标题和元信息位于边缘，材质与翻面操作悬浮在底部。光泽参数在“光效设置”里按需展开，分层说明和 ZIP 下载位于“作品信息”。浮层可以 Escape/关闭按钮关闭并恢复焦点，显示/隐藏不挤压卡片画布。入场只运行一次，减少动态偏好切换不会再次隐藏工具。环境光与少量星尘复用 HoloAtmosphere，暂停和后台状态会停止动画。

“光效设置”包含按“灵感 / 材质 / 纹理 / 动态”分类的风格库：9 种材质、9 种纹理、8 套灵感搭配，均可平滑切换。玫瑰金、冰晶、曜石、欧泊在光学响应上各有区别；新增碎钻、水波、雕纹、织光、星云、光栅。“更多材质”也可直达完整目录，底部保留常用的五种材质。

“光影巡游”提供环绕、摇曳、蝶舞和悬浮四种轨迹，鼠标与拖动可随时接管；“点亮瞬间”或双击卡面触发掠光、光环、彗星、星芒中的一种单次光效；“透视拆层”展开四个真实图层，再次点击合拢并恢复原来的观察姿态。复位会关闭巡游与拆层。浮层在较矮窗口和手机上可滚动，保留舞台尺寸、分类及关闭入口。灵感搭配不改变当前正反面、暂停状态或图层资产，也不主动打开巡游。

## 本次素材与来源

四层输出位于 `apps/web-react/public/holo-samples/astral-v1/`，共用 1024×1536 画布：

- `subject.png`：复用项目 `public/sucai/profile-hero-character.png`，原始字节与 SHA-256 完全相同，未经重画、抠图、裁切或 Alpha 阈值改写。
- `background.png`：原创深靛/暗青星盘、刻线、角花设计，使用 Canvas 确定性绘制；不冒充 AI 森林画作。
- `effects.png`：原创透明前景星芒与金色光屑，独立于主体。
- `text.png`：使用原生字体生成的独立透明排版，来自样卡真实导出。页面也能下载四层 ZIP。

配置保存在 `card-config.json`。金属背面和双线边框由 Three.js 与 Canvas 生成，角色来源与界面里的“已有角色素材”标记一致。

## 生成工具记录

最初尝试用内置 `image_gen.imagegen` 生成原创“月隐灵狐”主构图，返回 `503 Service Unavailable / auth_unavailable`，账号池报“生图策略拦截”。该调用没有产出图片。未切换到 CLI 或其他收费生图通道。

本次实际样卡复用已有角色，原创绘制图形设计层。它不用于证明 image2 对任意图片的精细主体分离已经通过实测。

尝试的主图提示词如下（生成失败，没有被当作成品）：

> Use case: stylized-concept. Asset type: master composition artwork for an original premium layered holographic collectible card, 2:3 portrait, 1024×1536 or higher same ratio. Only painted art, no mockup. An exquisitely illustrated white moon fox, graceful anatomically coherent body and one large flowing tail, moving through a moonlit ancient forest. Fine white/silver fur and whiskers, amber eyes, cyan reflected light and gold rimlight. Keep all ears, paws and tail within canvas. Deep forest teal and midnight navy, slender trees and engraved foliage at the sides, distant mist, quiet ivory moon behind the fox, few copper-gold ginkgo leaves near the outer foreground. Refined East Asian fantasy book illustration with engraved ink detail and luminous hand-painted color. Fox occupies x10–92%, y18–81%; face around x65%, y34%. Top9% and bottom17% quieter for separate type. No text, logos, watermark, frame, baked foil, checkerboard or multiple panels.

## 分层与材质

使用完整 2:3 画布，不使用旧版的绘图区缩小。正面背景、主体、前景、文字为独立真实 Z 平面，默认层距约为 0.002、0.114、0.185、0.226（卡高 3），“平面对照”可收回层距。

正交相机保持正面各层对齐。镭射相位随卡片局部观察方向变化，叠加窄条扫光及细闪点；提供镭射、烫金、银箔、珠光和原画，切换时插值混合材质权重。流光、星砂、极光共用卡面坐标，细颗粒按屏幕导数抗锯齿，卡框补充金属刻纹。保留低 Alpha 细节，并使用预乘透明采样减少缩放边缘暗边。角色文件本身没有改变。

使用 GSAP 实现鼠标跟随、拖拽、翻面、巡游与素材入场；四种轨迹复用一条时间线，暂停、隐藏、离屏与减少动态设置不持续运行。减少动态偏好通过原生媒体查询即时监听，有限过渡直接到达已选状态，追光取消。平面与浮雕对照、导出当前画面、下载分层素材均在样卡页完成。PNG 是静态快照；ZIP 是素材与配置，包含光纹、巡游开关、轨迹、追光形状和拆层选择，不是独立网页应用。

## 重建与检查

```bash
cd apps/web-react
WEB_BASE_URL=http://127.0.0.1:3106 node scripts/build-astral-sample-assets.mjs
npm run test:holo-card
WEB_BASE_URL=http://127.0.0.1:3106 npx playwright test tests/e2e/holo-card-sample.spec.js tests/e2e/holo-card-play.spec.js tests/e2e/holo-card-library.spec.js --project=chromium --workers=1
```

生成脚本只读取项目已有立绘、绘制图形背景和前景，不调用图片 API。专属测试核对真实 PNG、同尺寸、原始字节、导出、图层间距与实际像素变化，并记录文字与主体的 Alpha 重叠区域。截图用于人工评估成品观感；结构和像素检查不等同于完成美术还原验收。

本次素材检查：主体透明像素约 41.74%，最大 Alpha 为原文件已有的 252；前景光屑透明约 95.27%，文字层透明约 96.35%。文字与主体全图交集约占主体像素的 1.92%；画布高度 15%–45% 的检查区没有文字像素。底部 78%–92% 区域文字覆盖约 14.26% 的主体像素，保留为需要人工判断的排版取舍，不称为完全无遮挡。
