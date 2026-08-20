import tryonMenuCover from "@react/legacy-static/assets/ecommerce/tryon-preview.webp";
import listingMenuCover from "@react/legacy-static/assets/ecommerce/listing-preview.webp";
import detailMenuCover from "@react/legacy-static/assets/ecommerce/detail-preview.webp";
import {
  HANDHELD_USE_SHOT_SHARPNESS_OVERRIDE,
  isHandheldUseShotId,
} from "./handheldCommerce.js";

export const ECOMMERCE_MODES = [
  {
    id: "shoot",
    label: "AI 创意商拍",
    shortLabel: "AI 商拍",
    tagline: "影棚级商品场景图",
    description: "保留商品细节，生成可直接用于上架和投放的专业商拍图。",
    icon: "bi-camera-fill",
    ratio: "4:5",
    maxCount: 4,
    fields: ["market", "scene", "tone"],
    prompt:
      "生成专业影棚级商品商拍图。商品是绝对视觉主体，使用真实摄影光线、准确材质、自然接触阴影和克制的商业场景，不添加文字与无关商品。",
  },
  {
    id: "listing",
    label: "商品套图",
    shortLabel: "商品套图",
    tagline: "主图与卖点图成套生成",
    description: "按目标平台生成统一风格的商品主图、卖点图和场景图。",
    icon: "bi-images",
    ratio: "1:1",
    maxCount: 7,
    fields: ["platform", "market", "language", "tone", "modules"],
    prompt:
      "生成一套风格统一但构图各有侧重的商品 Listing 图片，覆盖纯净主图、核心卖点、使用场景和细节展示，适合连续上架使用。",
  },
  {
    id: "clone",
    label: "爆款图复刻",
    shortLabel: "爆款复刻",
    tagline: "复用成熟视觉结构",
    description: "参考爆款图的构图、光线和版式，用你的商品生成同类高转化视觉。",
    uploadTitle: "爆款参考与商品原图",
    uploadHint: "第 1 张爆款参考图，第 2 张为需替换的商品图",
    referenceLabels: ["爆款参考", "商品原图"],
    icon: "bi-copy",
    ratio: "1:1",
    maxCount: 4,
    minFiles: 1,
    fields: ["language", "tone"],
    prompt:
      "第一张参考图只定义构图、版式、色彩、光线和场景关系，第二张参考图定义必须保留的商品身份。用第二张商品替换参考图中的原商品，删除参考品牌和原文案；不得复制商标、人物身份或受保护的品牌元素。",
  },
  {
    id: "detail",
    label: "A+ / 详情页",
    shortLabel: "A+ 详情",
    tagline: "整套详情页视觉",
    description: "根据平台规范组织首屏、卖点、场景和商品细节模块。",
    icon: "bi-layout-text-window-reverse",
    ratio: "3:4",
    maxCount: 1,
    fields: ["platform", "market", "language", "tone", "modules"],
    prompt:
      "生成一张完整的纵向电商详情页，模块连续排列，具有清晰的信息层级和统一品牌视觉，不展示编辑器界面、设备样机或散乱截图。",
  },
  {
    id: "campaign",
    label: "AI 营销图",
    shortLabel: "营销图",
    tagline: "促销海报与社媒素材",
    description: "生成适配活动、社媒和广告投放的高转化商品营销图。",
    icon: "bi-megaphone-fill",
    ratio: "4:5",
    maxCount: 4,
    fields: ["platform", "market", "language", "campaign", "tone"],
    prompt:
      "生成高转化商品营销视觉，商品主体突出，活动氛围明确，标题区与利益点区域层级清楚，画面可直接用于社媒和广告投放。",
  },
  {
    id: "background",
    label: "AI 背景图",
    shortLabel: "背景生成",
    tagline: "商品场景与背景替换",
    description: "保持商品不变，为商品生成自然、可信且匹配品类的商业背景。",
    icon: "bi-card-image",
    ratio: "1:1",
    maxCount: 4,
    fields: ["market", "scene", "tone"],
    prompt:
      "只重做商品以外的背景和环境，严格保持商品本体、包装、Logo、颜色、比例和材质不变，生成自然接触阴影与可信空间关系，不添加文字。",
  },
  {
    id: "outpaint",
    label: "智能扩图",
    shortLabel: "智能扩图",
    tagline: "扩展画面与改尺寸",
    description: "扩展原图边界，生成适配不同电商版位的新画幅。",
    icon: "bi-arrows-angle-expand",
    ratio: "16:9",
    maxCount: 1,
    fields: ["tone"],
    prompt:
      "对参考图进行高质量智能扩图。原图内容、商品、文字和构图核心区域保持不变，只在画面边界外自然延展背景、光线与纹理，接缝不可见。",
  },
  {
    id: "enhance",
    label: "真实增强",
    shortLabel: "清晰增强",
    tagline: "商品图清晰修复",
    description: "修复模糊、噪点和压缩痕迹，保留真实商品细节。",
    icon: "bi-badge-hd-fill",
    ratio: "1:1",
    maxCount: 1,
    fields: [],
    prompt:
      "对参考商品图进行真实清晰增强：修复模糊、噪点、锯齿与压缩痕迹，提高材质和边缘细节，但不得改变构图、商品造型、颜色、Logo、包装文字或背景内容。",
  },
  {
    id: "tryon",
    label: "AI 虚拟试衣",
    shortLabel: "虚拟试衣",
    tagline: "服装生成真人上身效果",
    description: "服装和模特分开上传，生成一套真实自然的电商上身图。",
    uploadTitle: "分别上传服装和模特",
    uploadHint: "服装必填；模特和场景使用画布所选参考图",
    referenceLabels: ["服装", "模特", "场景"],
    icon: "bi-person-standing-dress",
    ratio: "2:3",
    maxCount: 4,
    fields: ["apparel", "model", "scene"],
    prompt:
      "将第 1 张参考图中的服装准确穿到第 2 张参考图中的同一位模特身上，并置于第 3 张参考图的场景环境中。必须保持第 2 张模特的脸型、五官、肤色、年龄感、发型和体型，禁止换成相似路人或按人群另造人物。保持服装款式、颜色、图案、剪裁、材质和垂坠感一致。输出全画幅相机实拍的电商时装摄影，保留面料织纹、缝线、褶皱与真实光影，禁止CG、塑料感和过度磨皮，不改变服装设计。",
  },
  {
    id: "handheld",
    label: "手持商品图",
    shortLabel: "手持商品",
    tagline: "电商人手持主图与套图",
    description:
      "上传白底商品，按品类、握持、出镜和渠道一次出可上架的手持图或详情套图。",
    uploadTitle: "上传商品图",
    uploadHint: "商品必填；模特、场景和构图参考按任务可选",
    referenceLabels: ["商品", "模特", "场景"],
    icon: "bi-hand-index-thumb-fill",
    ratio: "4:5",
    maxCount: 4,
    fields: ["pose", "scene", "tone"],
    prompt:
      "把参考商品按真实毫米尺度、不变形地放进一只解剖学正确的手里。必须保持商品刚性外形、长宽厚比例、边角、孔位、包装、Logo、文字、颜色、材质和真实尺寸；商品身份面必须锐利清晰可读。手指骨骼、左右手、握持受力、透视、接触阴影与局部遮挡必须像实拍；手迁就商品，商品不得被手挤压变形。手可以挡住商品局部，但不得挡住关键品牌面，禁止六指、关节反折和手指穿透商品。禁止把场景或构图参考里的人物、原商品或品牌带入结果。",
  },
  {
    id: "accessory",
    label: "AI 饰品穿戴",
    shortLabel: "饰品穿戴",
    tagline: "珠宝眼镜腕表真实佩戴",
    description:
      "为耳饰、项链、戒指、手链、胸针、发饰、腕表和眼镜生成真人佩戴商业图。",
    uploadTitle: "饰品身份参考",
    uploadHint: "第 1 张饰品图必填；模特与场景可选",
    referenceLabels: ["饰品", "模特", "场景"],
    icon: "bi-gem",
    ratio: "4:5",
    maxCount: 4,
    fields: ["market", "model", "pose", "tone"],
    prompt:
      "将参考饰品准确佩戴到真人模特的正确身体位置，保持饰品造型、尺寸比例、颜色、材质和细节一致。佩戴角度、皮肤接触、遮挡、反射与阴影必须符合真实摄影规律。",
  },
  {
    id: "backdrop",
    label: "背景复刻",
    shortLabel: "背景复刻",
    tagline: "复用参考图场景风格",
    description: "把参考背景的空间、光线和色彩迁移到新的商品图。",
    uploadTitle: "商品与背景参考",
    uploadHint: "第 1 张商品图，第 2 张背景参考图",
    referenceLabels: ["商品", "背景"],
    icon: "bi-layers-fill",
    ratio: "1:1",
    maxCount: 4,
    minFiles: 2,
    fields: ["tone"],
    prompt:
      "第一张参考图是必须完整保留的商品，第二张参考图是需要复刻的背景。迁移第二张图的空间、布景、光线方向、色彩与氛围，将第一张商品自然放入该环境；不得复制第二张图中的商品、文字或品牌。",
  },
  {
    id: "shadow",
    label: "AI 商品阴影",
    shortLabel: "商品阴影",
    tagline: "添加自然立体商品阴影",
    description: "为商品自动补充符合光源与接触面的真实阴影。",
    uploadTitle: "商品原图",
    uploadHint: "建议上传纯色或透明背景商品图",
    referenceLabels: ["商品"],
    icon: "bi-circle-half",
    ratio: "1:1",
    maxCount: 1,
    fields: ["shadow"],
    prompt:
      "只为参考商品添加专业、自然且符合光源方向的真实阴影，增强深度与立体感。商品本体、背景、构图、颜色、Logo 和包装文字不得发生任何变化。",
  },
];

export const ECOMMERCE_MODULES = [
  {
    value: "hero",
    label: "首屏主视觉",
    hint: "传递核心价值",
    icon: "bi-image",
    direction:
      "商品占据明确视觉中心，构图干净，预留克制的标题安全区，适合作为首屏与主图。",
  },
  {
    value: "selling",
    label: "核心卖点图",
    hint: "突出差异优势",
    icon: "bi-stars",
    direction:
      "围绕一个最重要卖点组织视觉，只呈现可由商品图或用户描述确认的信息，不虚构参数。",
  },
  {
    value: "scene",
    label: "使用场景图",
    hint: "呈现真实使用场景",
    icon: "bi-house-heart",
    direction:
      "把商品自然放入目标用户的真实使用环境，比例、接触关系、光线和阴影可信。",
  },
  {
    value: "angles",
    label: "多角度图",
    hint: "多角度呈现外观",
    icon: "bi-box",
    direction:
      "以清晰的三分之四视角或补充角度展示外观，不改变商品结构与零部件。",
  },
  {
    value: "mood",
    label: "场景氛围图",
    hint: "展示品牌情绪",
    icon: "bi-palette",
    direction:
      "延续整套视觉的色彩、布景材质与主光方向，强化品牌情绪但不抢夺商品主体。",
  },
  {
    value: "detail",
    label: "商品细节图",
    hint: "放大材质与工艺",
    icon: "bi-search",
    direction:
      "聚焦一处真实材质或工艺细节，保持纹理、Logo、接口和包装文字准确。",
  },
  {
    value: "spec",
    label: "规格参数图",
    hint: "说明尺寸与参数",
    icon: "bi-rulers",
    direction:
      "清晰呈现用户已经提供的尺寸、容量或规格信息；没有可靠参数时保留信息区，不得虚构数值。",
  },
  {
    value: "package",
    label: "包装清单图",
    hint: "展示包装与配件",
    icon: "bi-box2-heart",
    direction:
      "展示参考图中可以确认的商品、包装和随附配件；无法从参考图确认的物品不得补造。",
  },
];

const ECOMMERCE_DETAIL_ONLY_MODULES = [
  {
    value: "brand",
    label: "品牌故事图",
    hint: "传达品牌理念",
    icon: "bi-book",
    direction: "用克制的品牌叙事建立信任，只使用用户明确提供的品牌事实。",
  },
  {
    value: "comparison",
    label: "效果对比图",
    hint: "展示真实差异",
    icon: "bi-layout-split",
    direction: "呈现有真实依据的使用前后或方案差异，不伪造实验数据和效果。",
  },
  {
    value: "process",
    label: "工艺制作图",
    hint: "展示制作过程",
    icon: "bi-tools",
    direction: "展示用户已经确认的材料、工艺或制作步骤，不虚构认证和生产流程。",
  },
  {
    value: "series",
    label: "系列展示图",
    hint: "多色或多 SKU",
    icon: "bi-grid-3x3-gap",
    direction: "仅展示参考资料中真实存在的颜色和 SKU，统一比例与陈列方式。",
  },
  {
    value: "ingredients",
    label: "成分材质图",
    hint: "说明配方或材质",
    icon: "bi-droplet",
    direction: "清晰组织用户提供的成分、配方或材质信息，不增加未经确认的成分。",
  },
  {
    value: "service",
    label: "售后保障图",
    hint: "说明质保政策",
    icon: "bi-shield-check",
    direction: "仅展示用户明确提供的质保、退换和服务政策，不虚构承诺。",
  },
  {
    value: "usage",
    label: "使用建议图",
    hint: "说明使用方法",
    icon: "bi-info-circle",
    direction:
      "组织用户提供的使用步骤、维护方法和注意事项，表达清楚且不增加风险性建议。",
  },
];

export const ECOMMERCE_DETAIL_MODULES = [
  ...ECOMMERCE_MODULES,
  ...ECOMMERCE_DETAIL_ONLY_MODULES,
];

const LISTING_STRUCTURE_BLUEPRINTS = {
  white: {
    label: "白底主图",
    direction:
      "使用纯白或平台合规的干净背景，完整展示商品，不添加装饰、人物和无关文字。",
  },
  scene: {
    label: "场景图",
    direction:
      "展示商品的真实使用场景与目标人群关系，保持商品比例、光线和接触阴影可信。",
  },
  selling: {
    label: "卖点图",
    direction:
      "每张只突出一个真实核心卖点，信息层级清楚，不虚构参数、认证或效果。",
  },
  other: {
    label: "补充信息图",
    direction:
      "根据商品资料在细节、规格、包装清单和品牌氛围中选择最有价值的补充内容。",
  },
};

export function listingShotBlueprintsFromCounts(counts = {}) {
  return Object.entries(LISTING_STRUCTURE_BLUEPRINTS).flatMap(
    ([key, blueprint]) => {
      const count = Math.max(0, Math.min(7, Number(counts?.[key]) || 0));
      return Array.from({ length: count }, (_, index) => ({
        id: `${key}-${index + 1}`,
        label: count > 1 ? `${blueprint.label} ${index + 1}` : blueprint.label,
        direction: blueprint.direction,
      }));
    },
  );
}

export function supportedEcommerceModules(
  selectedModules = [],
  referenceCount = 0,
) {
  const selected = new Set(Array.from(selectedModules || []));
  const hasMultiAngleEvidence = Math.max(0, Number(referenceCount) || 0) >= 2;
  return ECOMMERCE_DETAIL_MODULES.filter(
    (item) =>
      selected.has(item.value) &&
      (item.value !== "angles" || hasMultiAngleEvidence),
  );
}

const ECOMMERCE_REFERENCE_ROLE_LABELS = {
  tryon: ["服装身份", "模特身份", "场景环境"],
  handheld: ["商品身份", "模特身份", "场景环境"],
  accessory: ["饰品身份", "模特身份"],
  backdrop: ["商品身份", "背景视觉"],
  clone: ["爆款视觉参考", "商品身份"],
};

const ECOMMERCE_PERSON_MODES = new Set(["tryon", "handheld", "accessory"]);

export function ecommerceConsistencyProfile(
  modeId,
  referenceCount = 1,
  options = {},
) {
  const id = String(modeId || "").trim();
  const count = Math.max(0, Number(referenceCount) || 0);
  const overrideRoles = Array.isArray(options.referenceRoles)
    ? options.referenceRoles.map(String).filter(Boolean)
    : null;
  const roles = overrideRoles?.length
    ? overrideRoles
    : Array.from({ length: count }, (_, index) => {
        return (
          ECOMMERCE_REFERENCE_ROLE_LABELS[id]?.[index] ||
          `商品身份角度 ${index + 1}`
        );
      });
  const hasPersonIdentity =
    typeof options.hasPersonIdentity === "boolean"
      ? options.hasPersonIdentity
      : ECOMMERCE_PERSON_MODES.has(id) && count >= 2;
  const essentialReferenceCount = [
    "tryon",
    "handheld",
    "accessory",
    "backdrop",
    "clone",
  ].includes(id)
    ? Math.min(
        count,
        id === "tryon" ? 3 : id === "handheld" ? Math.min(count, 4) : 2,
      )
    : Math.min(count, 1);

  let identityLock =
    "商品身份锁：参考商品是唯一商品事实来源。锁定整体几何轮廓、长宽厚比例、部件数量与位置、Logo、包装文字、颜色、纹理、接口、装饰和真实尺度；不可补造、删减、镜像或换成相似商品。";
  if (id === "tryon") {
    identityLock =
      count >= 3
        ? "三图身份锁：第 1 张是服装身份，锁定版型、长度、领口、袖型、图案、颜色、面料与缝线；第 2 张是模特身份，必须是同一人，锁定脸型、五官比例、肤色、年龄感、发型和体型，禁止生成另一个相似的人；第 3 张是拍摄场景，只提供环境、光线、材质与空间，禁止把场景图中的人物或商品带入结果。姿势与机位可以变化，人物身份和服装设计不可变化。"
        : "双身份锁：服装参考锁定版型、长度、领口、袖型、图案、颜色、面料与缝线；若有模特参考，模特参考锁定同一人的脸型、五官比例、肤色、年龄感、发型和体型。若有场景参考，场景参考只提供环境、光线、材质与空间，禁止把场景图中的人物或商品带入结果。姿势与机位可以变化，人物身份和服装设计不可变化。";
  } else if (id === "handheld") {
    identityLock = String(options.identityLock || "").trim()
      ? String(options.identityLock).trim()
      : count >= 3
        ? "三图身份锁：第 1 张是商品身份，锁定几何轮廓、长宽厚比例、包装、Logo、文字、颜色、材质和真实尺度；第 2 张是模特身份，必须是同一人，锁定脸型、五官比例、肤色、年龄感、发型和体型，禁止生成另一个相似的人；第 3 张是拍摄场景，只提供环境、光线、材质与空间，禁止把场景图中的人物或商品带入结果。只允许改变握持动作、机位与构图。"
        : count >= 2
          ? "双身份锁：商品参考锁定几何、包装、Logo、文字、颜色和真实尺度；若有模特参考，模特参考锁定同一人的脸型、五官比例、肤色、年龄感、发型和体型。若有场景参考，场景参考只提供环境、光线、材质与空间，禁止把场景图中的人物或商品带入结果。只允许改变握持动作、机位与构图。"
          : "商品身份锁：第 1 张是唯一商品事实来源，锁定几何轮廓、长宽厚比例、包装、Logo、文字、颜色、材质和真实尺度。生成一只解剖学正确的手按真实尺度握住该商品；默认不出人脸、不编造第二件商品。手指不得穿透商品，不得挡住关键品牌面。";
  } else if (id === "accessory") {
    identityLock = String(options.identityLock || "").trim()
      ? String(options.identityLock).trim()
      : "双身份锁：饰品参考锁定造型、尺寸、镶嵌数量、材质、颜色、五金和佩戴尺度；若有模特参考，模特参考锁定同一人的脸型、五官比例、肤色、年龄感、发型和体型。只允许改变姿势、机位与场景。";
  } else if (id === "backdrop") {
    identityLock =
      "分离参考锁：第一张只定义商品身份，第二张只定义背景的空间、材质、光线和色彩。严禁把背景参考中的商品、人物、文字或品牌复制到结果中。";
  } else if (id === "clone") {
    identityLock =
      count >= 2
        ? "复刻分离锁：第一张只定义视觉结构、构图、版式、色彩和光线，第二张只定义新商品身份。必须彻底移除参考图中的原商品、原品牌、Logo、人物身份和原文案；新商品的造型、比例、颜色、材质、Logo 与包装文字以第二张参考图为准。"
        : "单参考复刻锁：参考图定义视觉结构、构图、版式、色彩和光线。保留可确认的主体事实，但必须移除无法确认授权的品牌、Logo、水印和原文案，不得补造商品参数。";
  } else if (id === "background") {
    identityLock =
      "背景编辑边界锁：商品区域视为不可编辑的原始像素层。商品的像素位置、边界框、角度、尺度、轮廓、内部纹理、颜色、反光、Logo、文字和全部部件必须与参考图逐像素对齐；禁止旋转、倾斜、缩放、位移、裁切、补画、重绘或重新打光。只允许修改商品轮廓以外的背景像素，并在接触边缘生成自然过渡。";
  } else if (id === "shadow") {
    identityLock =
      "阴影编辑边界锁：商品本体和原背景都是不可编辑像素层，必须保持原位置、原角度、原尺度、原构图、原颜色和原细节逐像素对齐。只允许在商品接触面附近新增符合光源的阴影或倒影；禁止旋转、缩放、位移、裁切、重绘商品或替换背景。";
  } else if (id === "outpaint") {
    identityLock =
      "扩图边界锁：参考图的完整原始画布是不可编辑中心区域，原图内每个像素、商品、文字、位置、比例、光线和构图必须保持不变。只允许在原画布四周新增目标画幅所需像素，禁止缩放、裁切、移动、旋转或重绘原图内容。";
  } else if (id === "enhance") {
    identityLock =
      "增强编辑边界锁：输出必须与参考图保持像素级几何对齐，画幅、主体边界、位置、角度、尺度、颜色、Logo、文字、背景和全部结构不得改变。只允许恢复局部清晰度、压缩损失、噪点与边缘细节；禁止重新设计、补造纹理、换背景或改变光影。";
  }

  return {
    id: hasPersonIdentity
      ? "product-person-identity"
      : id === "backdrop" || id === "clone"
        ? "product-scene"
        : "product",
    roles,
    essentialReferenceCount,
    hasPersonIdentity,
    identityLock,
    seriesLock:
      id === "handheld" && roles.some((role) => role.includes("场景"))
        ? "系列连续性锁：所有图片并行生成，每张都必须独立、直接地使用同一张场景参考，保持同一空间结构、关键陈设、材质、色彩、主光方向和时间氛围；不得假设可以读取另一张成品，也不得自行换景。原始商品与人物身份参考始终拥有最高事实优先级。"
        : "系列连续性锁：所有图片并行生成，每张都必须直接继承相同的原始身份参考、布景语言、主光方向、色温、镜头质感、品牌色和版式节奏；不得假设可以读取另一张成品。原始身份参考始终拥有更高优先级。",
  };
}

const DEFAULT_SHOT_BLUEPRINTS = {
  shoot: [
    [
      "英雄商拍",
      "沿用参考图中信息最完整、最可信的商品角度，完整商品必须全部入镜并保留安全边距；不得为了制造新角度而推测、重绘或补造不可见结构，背景克制。",
    ],
    [
      "结构侧面",
      "只有参考图明确提供对应侧面信息时才使用补充角度；否则继续沿用已知角度，通过构图和光线形成差异，不得改变商品比例、颜色和部件。",
    ],
    ["材质特写", "聚焦最有辨识度的真实材质或工艺细节，保持光线体系一致。"],
    [
      "场景商拍",
      "将商品自然置入所选场景，保持与前几张相同的布景语言和主光方向。",
    ],
  ],
  campaign: [
    ["活动主视觉", "以商品和活动主题建立第一视觉层级，保留清晰标题安全区。"],
    [
      "利益点视觉",
      "突出一个真实核心卖点和转化利益点，不虚构折扣、价格或参数。",
    ],
    [
      "场景传播图",
      "在真实使用场景中表达活动氛围，继续使用同一品牌色和摄影风格。",
    ],
    [
      "社媒转化图",
      "使用更紧凑的移动端传播构图，信息区清楚，商品身份与整套保持一致。",
    ],
  ],
  background: [
    ["纯净主场景", "生成干净、留白合理的商业背景，严格保持商品本体不变。"],
    ["使用场景", "生成符合品类的真实使用环境，商品比例与接触阴影准确。"],
    ["品牌氛围", "强化所选视觉风格，但沿用第一张的主色、材质和光线体系。"],
    ["投放版位", "生成适合广告裁切和叠加文案的构图，保留充足安全区。"],
  ],
  tryon: [
    {
      id: "hero",
      label: "上身主图",
      direction:
        "完整展示服装版型、长度、图案和垂坠感，模特穿着自然，不改变服装设计。按商业时装摄影布光，面料质感清晰，主体与背景有镜头光学分离。",
    },
    {
      id: "side",
      label: "版型侧面",
      direction:
        "使用轻微三分之四角度展示侧面版型，保持同一模特身份和服装细节。",
    },
    {
      id: "lifestyle",
      label: "穿着场景",
      direction: "在所选拍摄场景中展示穿着效果，保持模特、服装和光线一致。",
    },
    {
      id: "fabric",
      label: "面料细节",
      direction: "以半身或局部构图展示真实面料、走线和剪裁，不重新设计服装。",
    },
  ],
  handheld: [
    {
      id: "hero",
      label: "手持主图",
      direction:
        "完整露出商品正面，手指结构、尺度、受力与遮挡准确；商品透视匹配手部空间，接触阴影和反光跟场景主光一致。主体占比大，适合电商主图。",
    },
    {
      id: "present",
      label: "递出展示",
      direction:
        "把商品递给镜头或托在掌心，手指避开 Logo 和包装主文字，品牌面完整可读。",
    },
    {
      id: "use",
      label: "使用瞬间",
      direction:
        "表现正在使用第 1 张参考图中同一件商品的瞬间，动作只服务该商品真实功能。禁止换成另一件货、场景里的杯盘摆件或更“好看”的相似品。商品外形仍完整可识别，尺度符合真人手掌。本张必须整张锐利清晰：商品、手、人物和场景陈设都要清楚，使用约 f/8 至 f/16 的深景深；禁止浅景深，禁止只让人物清晰而把商品、手或环境拍虚。",
    },
    {
      id: "detail",
      label: "材质特写",
      direction:
        "靠近第 1 张参考图中同一件商品与手的接触面做特写。必须仍是那一件货的材质、轮廓、颜色、Logo 和包装文字，只放大已有细节，禁止重绘结构、编造新零件，也禁止换成场景中的物品或另一件道具。背景克制虚化。",
    },
    {
      id: "ugc",
      label: "种草近景",
      direction:
        "生活化近景，浅景深，适合社媒封面；商品身份仍必须准确，不要做成自拍大头照。",
    },
    {
      id: "story",
      label: "竖屏投放",
      direction:
        "9:16 或竖构图，主体偏中上，底部预留标题安全区，商品与手仍是第一视觉。",
    },
  ],
  accessory: [
    ["佩戴主图", "在正确身体位置自然佩戴饰品，尺寸比例、反射和皮肤接触真实。"],
    ["三分之四", "使用补充角度展示佩戴关系，保持同一模特身份和饰品细节。"],
    ["局部特写", "聚焦饰品材质、镶嵌或五金细节，不改变商品结构。"],
    ["场景穿搭", "在克制场景中展示完整穿搭，饰品仍是明确视觉重点。"],
  ],
  backdrop: [
    [
      "背景复刻",
      "准确迁移背景参考的空间、光线、色彩和材质，只保留第一张图中的商品。",
    ],
    ["补充构图", "在同一背景视觉体系内调整商品机位与留白，商品本体保持不变。"],
    ["近景构图", "在同一场景中靠近商品展示材质，光源方向与第一张成品一致。"],
    [
      "投放构图",
      "在同一背景体系中预留广告信息安全区，不复制参考背景中的文字或品牌。",
    ],
  ],
  clone: [
    [
      "结构复刻",
      "沿用爆款参考的视觉层级、主体占比和留白关系，用新商品完整替换原商品。",
    ],
    [
      "场景复刻",
      "延续参考图的场景逻辑、色彩和光线，但不得复制原品牌、人物身份或受保护文案。",
    ],
    [
      "卖点复刻",
      "复用参考图的信息层级，用用户提供的新商品卖点重写内容，不得沿用原商品事实。",
    ],
    ["投放复刻", "保持同套视觉语言，生成适合目标语言和投放版位的补充构图。"],
  ],
};

function normalizeShot(shot, index) {
  if (!shot) return null;
  if (Array.isArray(shot)) {
    return { id: `shot-${index + 1}`, label: shot[0], direction: shot[1] };
  }
  return shot;
}

export function ecommerceShotBlueprints(modeId, selectedModules = []) {
  const id = String(modeId || "").trim();
  if (id === "listing") {
    const selected = new Set(Array.from(selectedModules || []));
    return ECOMMERCE_MODULES.filter((item) => selected.has(item.value)).map(
      (item) => ({
        id: item.value,
        label: item.label,
        direction: item.direction,
      }),
    );
  }
  if (id === "detail") {
    return [
      {
        id: "detail-page",
        label: "完整详情长图",
        direction:
          "按首屏、核心卖点、使用场景、细节证明和收束区的顺序组织连续长图，模块过渡自然且信息层级清楚。",
      },
    ];
  }
  const defaults = DEFAULT_SHOT_BLUEPRINTS[id];
  if (defaults?.length) return defaults.map(normalizeShot).filter(Boolean);
  const mode = ecommerceModeById(id);
  return [
    {
      id: id || "output",
      label: mode.shortLabel || mode.label,
      direction: mode.prompt,
    },
  ];
}

export const TRYON_DEFAULT_LENS_ID = "portrait";

export const TRYON_LENS_OPTIONS = [
  {
    id: "auto",
    label: "不指定",
    range: "",
    effect: "不限制焦距，由模型自行决定透视和景深",
    prompt: "",
  },
  {
    id: "ultra-wide",
    label: "超广角 / 鱼眼",
    range: "≤24mm",
    effect: "视角极宽，近大远小明显，边缘拉伸或桶形畸变",
    prompt:
      "使用约 16mm 超广角光学：近大远小极强，边缘桶形畸变，空间被拉得很深，靠近镜头的肢体透视夸张。",
  },
  {
    id: "wide",
    label: "广角",
    range: "24–35mm",
    effect: "视野开阔，透视强烈，能强化纵深感，前景更大",
    prompt:
      "使用约 35mm、f/2.8 广角：视野开阔，前景更大，纵深清楚，环境与人物同时入画。",
  },
  {
    id: "normal",
    label: "标准",
    range: "40–60mm",
    effect: "视角和透视接近人眼，自然真实，无明显畸变",
    prompt:
      "使用约 50mm f/1.8 标准镜头：透视接近人眼，空间自然，主体清晰，背景轻微分离。",
  },
  {
    id: "portrait",
    label: "中长焦 / 人像",
    range: "70–135mm",
    effect: "轻微压缩透视，浅景深，背景虚化，面部更讨好",
    prompt:
      "使用约 85mm f/1.4 人像镜头：轻微长焦压缩，浅景深，背景奶油般虚化，面部和服装从环境中立体分离，像杂志封面商拍。",
  },
  {
    id: "tele",
    label: "长焦 / 超长焦",
    range: "≥135mm",
    effect: "空间强烈压缩，景深很浅，背景虚化明显",
    prompt:
      "使用约 135mm f/2 长焦：空间强烈压缩，景深极浅，背景大光斑虚化，人物从环境中分离。",
  },
  {
    id: "macro",
    label: "微距",
    range: "50–105mm",
    effect: "极近距离清晰拍摄细节，背景强烈虚化",
    prompt:
      "使用约 100mm 微距：极近距离，面料织纹、缝线、纽扣和皮肤细节锐利，背景强烈虚化。",
  },
];

const TRYON_PHOTO_CRAFT =
  "按全画幅相机实拍，禁止 CG、塑料感、蜡像皮肤和过度磨皮。面料织纹、缝线、褶皱、毛边与自然瑕疵必须可见；皮肤保留毛孔和真实次表面散射；要有明确主光、补光、高光和接触阴影。";

export function tryonLensById(id) {
  return (
    TRYON_LENS_OPTIONS.find((item) => item.id === id) ||
    TRYON_LENS_OPTIONS.find((item) => item.id === TRYON_DEFAULT_LENS_ID) ||
    TRYON_LENS_OPTIONS[0]
  );
}

export function buildTryonPhotographyPrompt(lens) {
  const option =
    lens && typeof lens === "object" && lens.id
      ? tryonLensById(lens.id)
      : tryonLensById(lens);
  if (!String(option.prompt || "").trim()) {
    return `摄影质感：${TRYON_PHOTO_CRAFT}焦距、透视和景深随构图自然形成，不要拍成证件照、平面贴图或手机直出。`;
  }
  const range = option.range ? `（${option.range}）` : "";
  return `摄影镜头：必须使用${option.label}${range}的光学特性，这是画面透视和景深的硬约束，不能忽略。${option.prompt}${TRYON_PHOTO_CRAFT}`;
}

export const TRYON_DEFAULT_LIGHT_ID = "fill";

export const TRYON_LIGHT_OPTIONS = [
  {
    id: "available",
    label: "现场光",
    prompt:
      "以第 3 张场景里已经存在的光线为唯一主光，继承它的方向、色温和阴影长度。只加极弱补光保住暗部面料，不要另起一套棚灯，也不要改成另一个时段。",
  },
  {
    id: "fill",
    label: "补光塑形",
    prompt:
      "主光方向和色温仍跟第 3 张场景走。在主光对面或机位旁加一块大柔光反光板，把服装褶皱、领口和织纹从阴影里托出来；接触影还在，暗部能看清质感。这是外拍时装的补光，不是换场景重打灯。",
  },
  {
    id: "rim",
    label: "轮廓分离",
    prompt:
      "场景环境光不动。只在人物侧后方加一束很窄的轮廓光，勾衣服边缘和发丝，让人和背景分开。面部和衣服正面仍吃场景光，不要整张变成电影低调光。",
  },
  {
    id: "negative",
    label: "压暗立体",
    prompt:
      "场景主光方向不变，用挡光把环境压一点，让服装体积和褶皱更清楚。暗部仍要有织纹，不要死黑，不要换成另一套灯光。",
  },
  {
    id: "hard",
    label: "硬光刻画",
    prompt:
      "如果第 3 张场景里有窗光或阳光，就用那束硬光做主光；没有硬光源就用场景里最亮的方向。阴影边缘清楚，面料高光小而锐，补光克制。不要把室内场景改成室外正午。",
  },
];

export function tryonLightById(id) {
  return (
    TRYON_LIGHT_OPTIONS.find((item) => item.id === id) ||
    TRYON_LIGHT_OPTIONS.find((item) => item.id === TRYON_DEFAULT_LIGHT_ID) ||
    TRYON_LIGHT_OPTIONS[0]
  );
}

export function buildTryonLightingPrompt(light) {
  const option =
    light && typeof light === "object" && light.id
      ? tryonLightById(light.id)
      : tryonLightById(light);
  return `光影：${option.label}。${option.prompt}`;
}

export {
  HANDHELD_ARCHITECTURE_OPTIONS,
  HANDHELD_CAMERA_OPTIONS,
  HANDHELD_DEPTH_OPTIONS,
  HANDHELD_FOCUS_OPTIONS,
  HANDHELD_MATERIAL_INTERACTION_OPTIONS,
  HANDHELD_PHOTO_PRESET_OPTIONS,
  HANDHELD_CATEGORY_OPTIONS,
  HANDHELD_CROP_OPTIONS,
  HANDHELD_DEFAULT_ARCHITECTURE_ID,
  HANDHELD_DEFAULT_CAMERA_ID,
  HANDHELD_DEFAULT_DEPTH_ID,
  HANDHELD_DEFAULT_FOCUS_ID,
  HANDHELD_DEFAULT_MATERIAL_INTERACTION_ID,
  HANDHELD_DEFAULT_CATEGORY_ID,
  HANDHELD_DEFAULT_CROP_ID,
  HANDHELD_DEFAULT_HAND_ID,
  HANDHELD_DEFAULT_LENS_ID,
  HANDHELD_DEFAULT_LIGHT_ID,
  HANDHELD_DEFAULT_PACK_ID,
  HANDHELD_DEFAULT_PACK_STATE_ID,
  HANDHELD_DEFAULT_PLATFORM_ID,
  HANDHELD_DEFAULT_POSE_ID,
  HANDHELD_DEFAULT_STYLE_ID,
  HANDHELD_HAND_OPTIONS,
  HANDHELD_LENS_OPTIONS,
  HANDHELD_LIGHT_OPTIONS,
  HANDHELD_LANGUAGE_OPTIONS,
  HANDHELD_PACK_OPTIONS,
  HANDHELD_PACK_STATE_OPTIONS,
  HANDHELD_PLATFORM_OPTIONS,
  HANDHELD_POSE_OPTIONS,
  HANDHELD_STYLE_OPTIONS,
  HANDHELD_USE_SHOT_SHARPNESS_OVERRIDE,
  buildHandheldIdentityLock,
  buildHandheldAnnotationPrompt,
  buildHandheldOutputConstraints,
  buildHandheldPosePrompt,
  buildHandheldStylePrompt,
  buildHandheldTaskPrompt,
  isHandheldUseShotId,
  normalizeHandheldAnnotations,
  handheldArchitectureById,
  handheldEffectiveArchitecture,
  handheldCameraById,
  handheldDepthById,
  handheldFocusById,
  handheldMaterialInteractionById,
  handheldPhotoPresetById,
  handheldCategoryById,
  handheldCropById,
  handheldCropNeedsPerson,
  handheldHandById,
  handheldLensById,
  handheldLightById,
  handheldPackById,
  handheldPackStateById,
  handheldPlatformById,
  handheldPoseById,
  handheldReferenceLabels,
  handheldShotBlueprints,
  handheldStyleById,
} from "./handheldCommerce.js";

export function buildEcommerceGenerationPlan({
  modeId,
  count = 1,
  selectedModules = [],
  basePrompt = "",
  referenceCount = 1,
  shotBlueprints = null,
  referenceRoles = null,
  identityLock = "",
  hasPersonIdentity,
  finalConstraints = "",
} = {}) {
  const mode = ecommerceModeById(modeId);
  const consistency = ecommerceConsistencyProfile(mode.id, referenceCount, {
    referenceRoles,
    identityLock,
    hasPersonIdentity,
  });
  const blueprints = Array.isArray(shotBlueprints)
    ? shotBlueprints.map(normalizeShot).filter(Boolean)
    : ecommerceShotBlueprints(mode.id, selectedModules);
  const requestedCount = Math.max(
    1,
    Math.min(Number(count) || 1, mode.maxCount || 1),
  );
  const shots = blueprints.slice(
    0,
    Math.min(requestedCount, blueprints.length || 1),
  );
  const seriesLock =
    shots.length > 1
      ? consistency.seriesLock
      : "准确执行本张图片职责，原始身份参考和其中可见细节优先级最高。";

  return shots.map((shot, index) => ({
    prompt: [
      String(basePrompt || "").trim(),
      consistency.identityLock,
      consistency.roles.length
        ? `参考图角色：${consistency.roles.join("；")}。`
        : "",
      `本张输出职责：${shot.label}。${shot.direction}`,
      shots.length > 1
        ? `这是整套输出的第 ${index + 1}/${shots.length} 张。`
        : "",
      seriesLock,
      String(finalConstraints || "").trim(),
      isHandheldUseShotId(shot.id) ? HANDHELD_USE_SHOT_SHARPNESS_OVERRIDE : "",
    ]
      .filter(Boolean)
      .join("\n"),
    kindVariant: mode.id,
    viewId: shot.id,
    viewLabel: `${mode.shortLabel || mode.label} · ${shot.label}`,
    count: 1,
  }));
}

export const ECOMMERCE_REVISION_DIRECTIONS = [
  {
    value: "precise",
    label: "精准修改",
    prompt: "只执行用户明确提出的修改，不主动重构画面。",
  },
  {
    value: "composition",
    label: "构图层级",
    prompt: "重点调整主体大小、视觉层级、留白和信息安全区。",
  },
  {
    value: "scene",
    label: "场景氛围",
    prompt: "重点调整背景、布景、色彩、光线与商业摄影氛围。",
  },
  {
    value: "copy",
    label: "文案版式",
    prompt: "重点调整标题、卖点信息、字体层级和文案安全区，文字必须清晰可读。",
  },
  {
    value: "product",
    label: "商品细节",
    prompt: "重点修正商品比例、材质、边缘、Logo、包装文字和接触阴影。",
  },
];

export function buildEcommerceRevisionPrompt({
  basePrompt = "",
  brief = "",
  direction = "precise",
  versionNumber = 2,
} = {}) {
  const instruction = String(brief || "").trim();
  if (!instruction) return "";
  const directionConfig =
    ECOMMERCE_REVISION_DIRECTIONS.find((item) => item.value === direction) ||
    ECOMMERCE_REVISION_DIRECTIONS[0];
  const version = Math.max(2, Number(versionNumber) || 2);

  return [
    `任务：基于当前电商成品生成第 V${version} 版定向调整。`,
    `本轮只修改：${instruction}。`,
    `调整方向：${directionConfig.label}。${directionConfig.prompt}`,
    "参考图角色：第一张参考图是当前成品，其余参考图是原始商品身份依据。必须同时继承当前成品的整体设计，并以原始商品参考校正商品本体。",
    "锁定规则：除本轮明确要求修改的内容外，商品造型、颜色、比例、Logo、包装文字、主体位置、画幅、品牌色、字体体系、光线方向和其他已完成区域全部保持不变。禁止重新随机设计整张图片。",
    "修改结果必须是完整可交付成品，不展示对比图、编辑器、标注、修改说明、水印或版本号。",
    String(basePrompt || "").trim()
      ? `原始业务要求仍然有效：\n${String(basePrompt).trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const ECOMMERCE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export const ECOMMERCE_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
export const ECOMMERCE_IMAGE_TARGET_BYTES = 2 * 1024 * 1024;
export const ECOMMERCE_IMAGE_ACCEPT =
  "image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp";

const ECOMMERCE_IMAGE_MIME_ALIASES = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

export function ecommerceImageMime(file) {
  const type = String(file?.type || "")
    .trim()
    .toLowerCase();
  if (ECOMMERCE_IMAGE_MIME_TYPES.has(type)) return type;
  if (ECOMMERCE_IMAGE_MIME_ALIASES[type])
    return ECOMMERCE_IMAGE_MIME_ALIASES[type];
  const name = String(file?.name || "")
    .trim()
    .toLowerCase();
  if (/\.(jpe?g)$/.test(name)) return "image/jpeg";
  if (/\.png$/.test(name)) return "image/png";
  if (/\.webp$/.test(name)) return "image/webp";
  return "";
}

export function isEcommerceHeicFile(file) {
  const type = String(file?.type || "")
    .trim()
    .toLowerCase();
  const name = String(file?.name || "")
    .trim()
    .toLowerCase();
  return (
    type === "image/heic" || type === "image/heif" || /\.hei[cf]$/.test(name)
  );
}

function cloneEcommerceImageFile(file, mime, fallbackName) {
  if (!file || !mime) return file;
  if (String(file.type || "") === mime && file.name) return file;
  if (
    typeof File === "undefined" ||
    typeof Blob === "undefined" ||
    !(file instanceof Blob)
  ) {
    return file;
  }
  try {
    const next = new File(
      [file],
      file.name || fallbackName || `upload.${mime.split("/")[1] || "jpg"}`,
      {
        type: mime,
        lastModified: file.lastModified || Date.now(),
      },
    );
    if (file.sourceUrl) {
      Object.defineProperty(next, "sourceUrl", { value: file.sourceUrl });
    }
    return next;
  } catch {
    return file;
  }
}

export async function coerceEcommerceImageFile(file) {
  if (!file || Number(file.size || 0) <= 0 || isEcommerceHeicFile(file))
    return null;
  const mime = ecommerceImageMime(file);
  if (mime) return cloneEcommerceImageFile(file, mime);
  try {
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const sniffed = sniffEcommerceImageBytes(header);
    if (!sniffed) return null;
    return cloneEcommerceImageFile(file, sniffed.type, `upload.${sniffed.ext}`);
  } catch {
    return null;
  }
}

export function ecommerceUploadRejectMessage(
  prepared,
  file,
  maxBytes = ECOMMERCE_IMAGE_MAX_BYTES,
) {
  const limitMb = Math.max(
    1,
    Math.round(Number(maxBytes || ECOMMERCE_IMAGE_MAX_BYTES) / (1024 * 1024)),
  );
  if (prepared?.oversized || prepared?.oversizedCount) {
    return `图片不能超过 ${limitMb}MB`;
  }
  if (isEcommerceHeicFile(file) || prepared?.heicCount) {
    return "暂不支持 HEIC，请先转为 JPG 或 PNG";
  }
  return "请上传 PNG、JPG 或 WebP 图片";
}

export function sniffEcommerceImageBytes(bytes) {
  const data =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return { type: "image/png", ext: "png" };
  }
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return { type: "image/jpeg", ext: "jpg" };
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return { type: "image/webp", ext: "webp" };
  }
  return null;
}

export function storageKeyFromMediaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/\/api\/v1\/files\/(.+?)(?:\?|#|$)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).replace(/^\/+/, "").trim();
  } catch {
    return String(match[1] || "")
      .replace(/^\/+/, "")
      .trim();
  }
}

export function normalizeTaskImageKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.includes("/api/v1/files/")) {
    return storageKeyFromMediaUrl(raw);
  }
  return raw.replace(/^\/+/, "");
}

export function isReusableTaskImageKey(key) {
  const value = String(key || "").trim();
  if (
    !value ||
    value.includes("..") ||
    value.includes("\\") ||
    value.includes("://")
  ) {
    return false;
  }
  return /^(uploads|tasks|ecommerce-catalog|ecommerce-tryon|ecommerce-handheld)\//.test(
    value,
  );
}

export function attachEcommerceUploadKey(file, key) {
  const value = normalizeTaskImageKey(key);
  if (!file || !isReusableTaskImageKey(value)) return file;
  try {
    Object.defineProperty(file, "uploadKey", {
      value,
      configurable: true,
    });
  } catch {
    file.uploadKey = value;
  }
  return file;
}

function ecommerceReferenceKey(file) {
  const sourceUrl = String(file?.sourceUrl || "").trim();
  if (sourceUrl) return `source:${sourceUrl}`;
  return `file:${file?.name}:${file?.size}:${file?.lastModified}`;
}

export function prepareEcommerceInputFiles(
  existingFiles,
  incomingFiles,
  options = {},
) {
  const limit = Math.max(1, Number(options.limit || 6));
  const maxBytes = Math.max(
    1,
    Number(options.maxBytes || ECOMMERCE_IMAGE_MAX_BYTES),
  );
  const existing = Array.from(existingFiles || []);
  const incoming = Array.from(incomingFiles || []);
  const heicFiles = incoming.filter((file) => isEcommerceHeicFile(file));
  const typed = incoming
    .map((file) => {
      const mime = ecommerceImageMime(file);
      return mime ? cloneEcommerceImageFile(file, mime) : file;
    })
    .filter((file) => Boolean(ecommerceImageMime(file)));
  const accepted = typed.filter((file) => Number(file?.size || 0) > 0);
  const skipSizeCap = Boolean(options.skipSizeCap);
  const oversizedFiles = accepted.filter(
    (file) => Number(file?.size || 0) > maxBytes,
  );
  const withinSize = skipSizeCap
    ? accepted
    : accepted.filter((file) => Number(file?.size || 0) <= maxBytes);
  const existingKeys = new Set(existing.map(ecommerceReferenceKey));
  const unique = [];
  for (const file of withinSize) {
    const key = ecommerceReferenceKey(file);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    unique.push(file);
  }
  const available = Math.max(0, limit - existing.length);
  const next = unique.slice(0, available);
  return {
    next,
    invalidCount: incoming.length - accepted.length,
    heicCount: heicFiles.length,
    duplicateCount: withinSize.length - unique.length,
    overflowCount: Math.max(0, unique.length - available),
    oversized: oversizedFiles[0] || null,
    oversizedCount: oversizedFiles.length,
  };
}

export function filterEcommerceOutputsByMode(outputs, outputKinds, modeId) {
  const prefix = `ui-design-ecommerce-${String(modeId || "").trim()}-`;
  if (!modeId) return [];
  return Array.from(outputs || []).filter((url) =>
    String(outputKinds?.[url] || "").startsWith(prefix),
  );
}

function menuItem(id) {
  const mode = ECOMMERCE_MODES.find((item) => item.id === id);
  return { ...mode, to: `/ecommerce-design?tool=${id}` };
}

export const ECOMMERCE_MENU_GROUPS = [
  {
    id: "model",
    label: "服饰模特",
    description: "服装、商品与饰品的真人展示",
    cover: tryonMenuCover,
    items: ["tryon", "handheld", "accessory"].map(menuItem),
  },
  {
    id: "create",
    label: "商品设计",
    description: "商拍、套图与详情页视觉",
    cover: listingMenuCover,
    items: ["shoot", "listing", "detail"].map(menuItem),
  },
  {
    id: "image",
    label: "图片处理",
    description: "营销图、背景、阴影与画质处理",
    cover: detailMenuCover,
    items: [
      "campaign",
      "background",
      "backdrop",
      "shadow",
      "outpaint",
      "enhance",
    ].map(menuItem),
  },
];

export const ECOMMERCE_MENU_LINKS = ECOMMERCE_MENU_GROUPS.flatMap(
  (group) => group.items,
);

/** 页面侧栏与顶栏 mega 菜单保持同一分组与顺序 */
export const ECOMMERCE_RAIL_GROUPS = ECOMMERCE_MENU_GROUPS.map((group) => ({
  id: group.id,
  label: group.label,
  items: group.items,
}));

export const ECOMMERCE_RAIL_MODES = ECOMMERCE_RAIL_GROUPS.flatMap(
  (group) => group.items,
);

export function ecommerceModeById(id) {
  return (
    ECOMMERCE_MODES.find((mode) => mode.id === id) ||
    ECOMMERCE_MODES.find((mode) => mode.id === "detail")
  );
}
