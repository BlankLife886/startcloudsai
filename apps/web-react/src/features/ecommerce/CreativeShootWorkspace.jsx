import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Images,
  LockKeyhole,
  PackageOpen,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import listingPreview from "@react/legacy-static/assets/ecommerce/listing-preview.webp";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { CommerceSelect } from "./CommerceSelect.jsx";
import "./CreativeShootWorkspace.css";

const DIRECTIONS = [
  {
    id: "studio",
    label: "干净棚拍",
    enLabel: "Clean studio",
    detail: "适合主图、官网首屏",
    enDetail: "For hero images and storefronts",
    scene: "纯色影棚",
    tone: "极简高级",
    position: "8% 50%",
  },
  {
    id: "lifestyle",
    label: "生活场景",
    enLabel: "Lifestyle",
    detail: "适合种草、使用情境",
    enDetail: "For social and in-use scenes",
    scene: "家居生活",
    tone: "真实自然",
    position: "62% 20%",
  },
  {
    id: "premium",
    label: "质感特写",
    enLabel: "Premium detail",
    detail: "适合材质、工艺卖点",
    enDetail: "For material and craft details",
    scene: "纯色影棚",
    tone: "轻奢质感",
    position: "63% 82%",
  },
  {
    id: "concept",
    label: "概念创意",
    enLabel: "Concept creative",
    detail: "适合新品、广告投放",
    enDetail: "For launches and campaigns",
    scene: "科技空间",
    tone: "科技未来",
    position: "94% 82%",
  },
];

export const CREATIVE_SHOOT_SHOTS = [
  {
    id: "hero",
    label: "商品主视觉",
    enLabel: "Hero image",
    hint: "完整展示商品，建立第一印象",
    enHint: "Show the complete product clearly",
    direction:
      "完整商品全部入镜并保留安全边距，使用信息最完整的可信角度，商品是唯一明确视觉中心，适合作为首张主视觉。",
  },
  {
    id: "lifestyle",
    label: "使用场景",
    enLabel: "Lifestyle scene",
    hint: "说明使用方式、环境和人群",
    enHint: "Show context, environment and audience",
    direction:
      "把商品自然置入目标用户真实使用环境，清楚表达使用方式、尺度和场景价值，保持商品身份与主视觉一致。",
  },
  {
    id: "detail",
    label: "材质细节",
    enLabel: "Material detail",
    hint: "证明材质、工艺和品质",
    enHint: "Prove material, craft and quality",
    direction:
      "聚焦参考图中确实可见的材质、纹理、接口或工艺细节，只放大已有事实，不补造不可见结构。",
  },
  {
    id: "selling",
    label: "卖点表达",
    enLabel: "Selling point",
    hint: "围绕一个核心购买理由构图",
    enHint: "Build around one purchase reason",
    direction:
      "围绕用户填写的一个核心卖点组织商业构图，通过场景和视觉关系表达价值，不虚构参数、认证或效果。",
  },
  {
    id: "scale",
    label: "尺寸比例",
    enLabel: "Scale reference",
    hint: "帮助用户理解真实大小",
    enHint: "Communicate real-world size",
    direction:
      "通过可信参照物或使用关系说明商品真实尺寸和比例，不改变商品本体，不使用会误导尺度的夸张透视。",
  },
  {
    id: "packaging",
    label: "包装与配件",
    enLabel: "Packaging set",
    hint: "展示包装、配件和完整清单",
    enHint: "Show packaging and included items",
    direction:
      "根据参考图展示真实包装、配件和商品组合，只呈现明确提供的物品、数量和文字，不补造赠品或包装信息。",
  },
];

const USE_CASES = [
  ["listing", "商品上架", "Listing"],
  ["social", "社媒种草", "Social"],
  ["ads", "广告投放", "Ads"],
  ["brand", "品牌视觉", "Brand"],
];

const GOALS = [
  ["conversion", "促进转化", "Conversion"],
  ["premium", "建立质感", "Premium"],
  ["explain", "解释功能", "Explain"],
  ["launch", "新品传播", "Launch"],
];

const RATIOS = [
  ["1:1", "方图"],
  ["4:5", "竖图"],
  ["3:4", "详情"],
  ["16:9", "横图"],
  ["9:16", "竖屏"],
];

function directionFor(scene, tone) {
  return (
    DIRECTIONS.find(
      (direction) => direction.scene === scene && direction.tone === tone,
    ) || DIRECTIONS[0]
  );
}

export function CreativeShootWorkspace({
  english = false,
  productSources = [],
  productName = "",
  sellingPoints = "",
  useCase = "listing",
  goal = "conversion",
  audience = "",
  platform = "",
  platformOptions = [],
  sku = "",
  protectedElements = "",
  shots = [],
  scene = "",
  tone = "",
  market = "",
  marketOptions = [],
  aspectRatio = "4:5",
  outputCount = 1,
  models = [],
  modelId = "",
  plan = [],
  readiness = "",
  costLabel = "",
  generateDisabled = false,
  onUpload,
  onOpenProducts,
  onRemoveProduct,
  onProductNameChange,
  onSellingPointsChange,
  onUseCaseChange,
  onGoalChange,
  onAudienceChange,
  onPlatformChange,
  onSkuChange,
  onProtectedElementsChange,
  onToggleShot,
  onMoveShot,
  onSelectDirection,
  onAspectRatioChange,
  onMarketChange,
  onModelChange,
  onGenerate,
}) {
  const hasProduct = productSources.length > 0;
  const activeDirection = directionFor(scene, tone);
  const selectedShots = shots
    .map((shotId) => CREATIVE_SHOOT_SHOTS.find((shot) => shot.id === shotId))
    .filter(Boolean);
  const availableShots = CREATIVE_SHOOT_SHOTS.filter(
    (shot) => !shots.includes(shot.id),
  );
  const activeUseCase = USE_CASES.find(([id]) => id === useCase) || USE_CASES[0];
  const activeGoal = GOALS.find(([id]) => id === goal) || GOALS[0];
  const [ratioWidth, ratioHeight] = String(aspectRatio || "4:5")
    .split(":")
    .map(Number);
  const previewStyle = {
    "--creative-shot-ratio": `${ratioWidth > 0 ? ratioWidth : 4} / ${ratioHeight > 0 ? ratioHeight : 5}`,
  };
  const copy = english
    ? {
        title: "Create a commercial shoot",
        subtitle: "Choose a product and a direction. The rest is optional.",
        stepTask: "Define task",
        stepProduct: "Choose product",
        stepDirection: "Choose direction",
        stepShots: "Build shot list",
        stepOutput: "Choose output",
        taskHint: "Tell the system where the images will be used and what they must achieve.",
        useCase: "Use case",
        goal: "Business goal",
        audience: "Audience",
        audiencePlaceholder: "e.g. Urban commuters, 25-35",
        platform: "Channel",
        productHint: "Use a clear front image. Add more angles when shape matters.",
        upload: "Upload product",
        library: "Product library",
        addAngle: "Add angle",
        remove: "Remove image",
        productName: "Product name",
        productPlaceholder: "e.g. Wireless headphones",
        truth: "Product truth and protected elements",
        truthHint: "These facts have higher priority than creative styling.",
        sku: "SKU / model",
        skuPlaceholder: "e.g. NC-700 Orange",
        protected: "Must not change",
        protectedPlaceholder: "Shape, color, logo, packaging copy, ports and included parts",
        directionHint: "One click sets scene, light and visual tone.",
        recommended: "Recommended",
        briefHint: "Optional. Describe only what the result must communicate.",
        briefPlaceholder:
          "e.g. Emphasize comfort and lightweight construction. Keep an empty area on the upper right.",
        shotsHint: "Choose up to four image roles and arrange their generation order.",
        selectedShots: "Selected shots",
        addShot: "Add shot",
        removeShot: "Remove shot",
        moveUp: "Move up",
        moveDown: "Move down",
        ratio: "Format",
        count: "Images",
        advanced: "Advanced settings",
        market: "Market",
        model: "Model",
        summary: "Ready to create",
        summaryHint: "Review the task before generation",
        composition: "Composition preview, not a generated result",
        productReady: "Product reference ready",
        productMissing: "Product image required",
        taskReady: "Business goal configured",
        truthReady: "Product truth protected",
        directionReady: "Creative direction selected",
        briefReady: "Requirements added",
        briefOptional: "Requirements optional",
        outputReady: "Output configured",
        generate: "Generate commercial shoot",
      }
    : {
        title: "创建一组商业成片",
        subtitle: "选好商品和拍摄方向即可生成，其余内容都可选。",
        stepTask: "定义任务",
        stepProduct: "选择商品",
        stepDirection: "选择方向",
        stepShots: "编排镜头",
        stepOutput: "选择输出",
        taskHint: "先说明图片用于哪里、面向谁，以及这次需要解决什么销售目标。",
        useCase: "图片用途",
        goal: "商业目标",
        audience: "目标人群",
        audiencePlaceholder: "例如：25-35岁城市通勤人群",
        platform: "目标渠道",
        productHint: "优先上传清晰正面图；结构复杂时再补充侧面和细节角度。",
        upload: "上传商品图",
        library: "从商品库选择",
        addAngle: "补充角度",
        remove: "移除商品图",
        productName: "商品名称",
        productPlaceholder: "例如：无线降噪耳机",
        truth: "商品事实与保护元素",
        truthHint: "这些事实的优先级高于创意风格，生成时必须保持不变。",
        sku: "SKU / 型号",
        skuPlaceholder: "例如：NC-700 活力橙",
        protected: "绝对不能改变",
        protectedPlaceholder: "外形比例、颜色、Logo、包装文字、接口位置和配件数量",
        directionHint: "一次选择会自动配置场景、光线与视觉风格。",
        recommended: "推荐",
        briefHint: "选填，只需描述这组图片必须传达什么。",
        briefPlaceholder:
          "例如：突出轻便和长时间佩戴舒适，画面右上方预留文案区域。",
        shotsHint: "最多选择四种图片职责，并按实际交付顺序排列。",
        selectedShots: "已选镜头",
        addShot: "添加镜头",
        removeShot: "移除镜头",
        moveUp: "上移",
        moveDown: "下移",
        ratio: "画面比例",
        count: "生成张数",
        advanced: "进阶设置",
        market: "目标市场",
        model: "生成模型",
        summary: "本次生成",
        summaryHint: "生成前确认任务内容",
        composition: "构图示意，非生成结果",
        productReady: "商品参考已准备",
        productMissing: "还需上传商品图",
        taskReady: "商业目标已配置",
        truthReady: "商品事实已锁定",
        directionReady: "拍摄方向已选择",
        briefReady: "补充要求已填写",
        briefOptional: "补充要求可留空",
        outputReady: "输出规格已配置",
        generate: "生成商业成片",
      };

  return (
    <section className="creative-flow" aria-labelledby="creative-flow-title">
      <header className="creative-flow__header">
        <div>
          <span>AI CREATIVE SHOOT</span>
          <h1 id="creative-flow-title">{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <ol aria-label={copy.title}>
          {[
            [copy.stepTask, true],
            [copy.stepProduct, hasProduct],
            [copy.stepDirection, true],
            [copy.stepShots, selectedShots.length > 0],
            [copy.stepOutput, true],
          ].map(([label, complete], index) => (
            <li key={label} className={complete ? "is-complete" : ""}>
              <span>{complete ? <Check size={12} /> : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </header>

      <div className="creative-flow__body">
        <div className="creative-flow__form">
          <section className="creative-flow__step" aria-labelledby="shoot-task-title">
            <header>
              <span>01</span>
              <div>
                <h2 id="shoot-task-title">{copy.stepTask}</h2>
                <p>{copy.taskHint}</p>
              </div>
            </header>
            <div className="creative-flow__task-grid">
              <fieldset>
                <legend>{copy.useCase}</legend>
                <div className="creative-flow__business-options">
                  {USE_CASES.map(([id, label, enLabel]) => (
                    <button
                      key={id}
                      type="button"
                      className={useCase === id ? "is-active" : ""}
                      aria-pressed={useCase === id}
                      onClick={() => onUseCaseChange?.(id)}
                    >
                      {english ? enLabel : label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>{copy.goal}</legend>
                <div className="creative-flow__business-options">
                  {GOALS.map(([id, label, enLabel]) => (
                    <button
                      key={id}
                      type="button"
                      className={goal === id ? "is-active" : ""}
                      aria-pressed={goal === id}
                      onClick={() => onGoalChange?.(id)}
                    >
                      {english ? enLabel : label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label>
                <span>{copy.platform}</span>
                <CommerceSelect
                  value={platform}
                  options={platformOptions}
                  onChange={onPlatformChange}
                  ariaLabel={copy.platform}
                />
              </label>
              <label>
                <span>{copy.audience}</span>
                <input
                  value={audience}
                  onChange={(event) => onAudienceChange?.(event.target.value)}
                  placeholder={copy.audiencePlaceholder}
                />
              </label>
            </div>
          </section>

          <section className="creative-flow__step" aria-labelledby="shoot-product-title">
            <header>
              <span>02</span>
              <div>
                <h2 id="shoot-product-title">{copy.stepProduct}</h2>
                <p>{copy.productHint}</p>
              </div>
            </header>

            {hasProduct ? (
              <div className="creative-flow__product-ready">
                <div className="creative-flow__product-images">
                  {productSources.map((source, index) => (
                    <figure key={`${source}-${index}`}>
                      <AuthenticatedImage
                        src={source}
                        alt={`${productName || copy.productName} ${index + 1}`}
                        maxDimension={520}
                      />
                      <button
                        type="button"
                        aria-label={`${copy.remove} ${index + 1}`}
                        onClick={() => onRemoveProduct?.(index)}
                      >
                        <X size={12} />
                      </button>
                      <span>{index === 0 ? "MAIN" : `0${index + 1}`}</span>
                    </figure>
                  ))}
                  {productSources.length < 6 && (
                    <button
                      type="button"
                      className="creative-flow__add-angle"
                      onClick={onUpload}
                    >
                      <ImagePlus size={18} />
                      {copy.addAngle}
                    </button>
                  )}
                </div>
                <div className="creative-flow__product-meta">
                  <label>
                    <span>{copy.productName}</span>
                    <input
                      value={productName}
                      onChange={(event) => onProductNameChange?.(event.target.value)}
                      placeholder={copy.productPlaceholder}
                    />
                  </label>
                  <button type="button" onClick={onOpenProducts}>
                    <PackageOpen size={15} />
                    {copy.library}
                  </button>
                </div>
              </div>
            ) : (
              <div className="creative-flow__product-empty">
                <div>
                  <ImagePlus size={25} />
                  <strong>{copy.upload}</strong>
                  <small>PNG · JPG · WebP</small>
                </div>
                <div>
                  <button type="button" onClick={onUpload}>
                    <ImagePlus size={16} />
                    {copy.upload}
                  </button>
                  <button type="button" onClick={onOpenProducts}>
                    <PackageOpen size={16} />
                    {copy.library}
                  </button>
                </div>
              </div>
            )}
            <details className="creative-flow__truth" open={hasProduct}>
              <summary>
                <LockKeyhole size={15} />
                <span>
                  <strong>{copy.truth}</strong>
                  <small>{copy.truthHint}</small>
                </span>
                <ChevronDown size={14} />
              </summary>
              <div>
                <label>
                  <span>{copy.sku}</span>
                  <input
                    value={sku}
                    onChange={(event) => onSkuChange?.(event.target.value)}
                    placeholder={copy.skuPlaceholder}
                  />
                </label>
                <label>
                  <span>{copy.protected}</span>
                  <textarea
                    value={protectedElements}
                    onChange={(event) =>
                      onProtectedElementsChange?.(event.target.value)
                    }
                    placeholder={copy.protectedPlaceholder}
                  />
                </label>
              </div>
            </details>
          </section>

          <section className="creative-flow__step" aria-labelledby="shoot-direction-title">
            <header>
              <span>03</span>
              <div>
                <h2 id="shoot-direction-title">{copy.stepDirection}</h2>
                <p>{copy.directionHint}</p>
              </div>
            </header>
            <div className="creative-flow__directions">
              {DIRECTIONS.map((direction, index) => {
                const active = activeDirection.id === direction.id;
                return (
                  <button
                    key={direction.id}
                    type="button"
                    className={active ? "is-active" : ""}
                    aria-pressed={active}
                    onClick={() => onSelectDirection?.(direction.scene, direction.tone)}
                  >
                    <span>
                      <img
                        src={listingPreview}
                        alt=""
                        style={{ objectPosition: direction.position }}
                      />
                      {active && <Check size={14} />}
                    </span>
                    <strong>{english ? direction.enLabel : direction.label}</strong>
                    <small>{english ? direction.enDetail : direction.detail}</small>
                    {index === 0 && <em>{copy.recommended}</em>}
                  </button>
                );
              })}
            </div>
            <label className="creative-flow__brief">
              <strong>{copy.briefHint}</strong>
              <textarea
                value={sellingPoints}
                onChange={(event) => onSellingPointsChange?.(event.target.value)}
                placeholder={copy.briefPlaceholder}
                maxLength={1200}
              />
              <span>{sellingPoints.length}/1200</span>
            </label>
          </section>

          <section className="creative-flow__step" aria-labelledby="shoot-shots-title">
            <header>
              <span>04</span>
              <div>
                <h2 id="shoot-shots-title">{copy.stepShots}</h2>
                <p>{copy.shotsHint}</p>
              </div>
            </header>
            <div className="creative-flow__shot-builder">
              <div>
                <small>{copy.selectedShots} · {selectedShots.length}/4</small>
                <ol>
                  {selectedShots.map((shot, index) => (
                    <li key={shot.id}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{english ? shot.enLabel : shot.label}</strong>
                        <small>{english ? shot.enHint : shot.hint}</small>
                      </div>
                      <button
                        type="button"
                        aria-label={`${copy.moveUp} ${shot.label}`}
                        disabled={index === 0}
                        onClick={() => onMoveShot?.(shot.id, -1)}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`${copy.moveDown} ${shot.label}`}
                        disabled={index === selectedShots.length - 1}
                        onClick={() => onMoveShot?.(shot.id, 1)}
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`${copy.removeShot} ${shot.label}`}
                        disabled={selectedShots.length === 1}
                        onClick={() => onToggleShot?.(shot.id)}
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="creative-flow__available-shots">
                <small>{copy.addShot}</small>
                <div>
                  {availableShots.map((shot) => (
                    <button
                      key={shot.id}
                      type="button"
                      disabled={selectedShots.length >= 4}
                      onClick={() => onToggleShot?.(shot.id)}
                    >
                      + {english ? shot.enLabel : shot.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="creative-flow__step" aria-labelledby="shoot-output-title">
            <header>
              <span>05</span>
              <div>
                <h2 id="shoot-output-title">{copy.stepOutput}</h2>
              </div>
            </header>
            <div className="creative-flow__output-row">
              <fieldset>
                <legend>{copy.ratio}</legend>
                <div className="creative-flow__segments">
                  {RATIOS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={aspectRatio === value ? "is-active" : ""}
                      aria-pressed={aspectRatio === value}
                      onClick={() => onAspectRatioChange?.(value)}
                    >
                      <strong>{value}</strong>
                      <small>{label}</small>
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>{copy.count}</legend>
                <div className="creative-flow__derived-count">
                  <strong>{outputCount}</strong>
                  <span>{english ? "Based on shot list" : "由镜头清单决定"}</span>
                </div>
              </fieldset>
            </div>

            <details className="creative-flow__advanced">
              <summary>
                <SlidersHorizontal size={15} />
                {copy.advanced}
                <ChevronDown size={14} />
              </summary>
              <div>
                <label>
                  <span>{copy.market}</span>
                  <CommerceSelect
                    value={market}
                    options={marketOptions}
                    onChange={onMarketChange}
                    ariaLabel={copy.market}
                  />
                </label>
                <label>
                  <span>{copy.model}</span>
                  <CommerceSelect
                    value={modelId}
                    options={models.map((item) => ({
                      value: item.id || item.publicModelKey,
                      label: item.label || item.name || item.id,
                    }))}
                    onChange={onModelChange}
                    placeholder={copy.model}
                    ariaLabel={copy.model}
                  />
                </label>
              </div>
            </details>
          </section>
        </div>

        <aside className="creative-flow__summary" aria-label={copy.summary}>
          <header>
            <div>
              <small>{copy.summary}</small>
              <strong>{copy.summaryHint}</strong>
            </div>
            <Sparkles size={18} />
          </header>
          <div className="creative-flow__preview" style={previewStyle}>
            <img src={listingPreview} alt={copy.composition} />
            <span>{copy.composition}</span>
            <b>{aspectRatio}</b>
          </div>
          <div className="creative-flow__summary-title">
            <strong>{productName || copy.productName}</strong>
            <span>
              {english ? activeUseCase[2] : activeUseCase[1]} ·{" "}
              {activeDirection[english ? "enLabel" : "label"]}
            </span>
          </div>
          <ul>
            <li className="is-ready">
              <Check size={14} />
              {copy.taskReady} · {english ? activeGoal[2] : activeGoal[1]}
            </li>
            <li className={hasProduct ? "is-ready" : ""}>
              {hasProduct ? <Check size={14} /> : <LockKeyhole size={14} />}
              {hasProduct ? copy.productReady : copy.productMissing}
            </li>
            <li className={protectedElements.trim() ? "is-ready" : ""}>
              {protectedElements.trim() ? <Check size={14} /> : <LockKeyhole size={14} />}
              {copy.truthReady}
            </li>
            <li className="is-ready">
              <Check size={14} />
              {copy.directionReady}
            </li>
            <li className={sellingPoints.trim() ? "is-ready" : ""}>
              {sellingPoints.trim() ? <Check size={14} /> : <span />}
              {sellingPoints.trim() ? copy.briefReady : copy.briefOptional}
            </li>
            <li className="is-ready">
              <Check size={14} />
              {selectedShots.length} × {aspectRatio} · {copy.outputReady}
            </li>
          </ul>
          <div className="creative-flow__shots">
            <Images size={15} />
            <div>
              {(plan.length ? plan : [{ viewLabel: activeDirection.label }]).map(
                (shot, index) => (
                  <span key={shot.viewId || index}>
                    {String(index + 1).padStart(2, "0")} ·{" "}
                    {shot.viewLabel?.split(" · ").pop() || activeDirection.label}
                  </span>
                ),
              )}
            </div>
          </div>
          <footer>
            <div>
              <span>{readiness}</span>
              <strong>{costLabel}</strong>
            </div>
            <button
              type="button"
              disabled={generateDisabled}
              onClick={onGenerate}
            >
              <Sparkles size={17} />
              {copy.generate}
              <ArrowRight size={16} />
            </button>
          </footer>
        </aside>
      </div>
    </section>
  );
}
