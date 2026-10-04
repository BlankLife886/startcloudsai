import { useMemo, useState } from "react";
import { CREATIVE_SHOOT_SHOTS } from "../../creativeShootShots.js";

// AI 商拍一套最多出几张；与 ecommerceTools 里 shoot 模式的 maxCount 一致
export const SHOOT_MAX_SHOTS = 4;

export const SHOOT_DEFAULT_SHOT_IDS = Object.freeze([
  "hero",
  "lifestyle",
  "detail",
  "selling",
]);

export const SHOOT_DEFAULT_PROTECTED_ELEMENTS =
  "商品外形与比例、颜色与材质、Logo、包装文字、接口位置、部件和配件数量";

export const SHOOT_USE_CASE_OPTIONS = [
  { id: "listing", label: "商品上架" },
  { id: "social", label: "社媒种草" },
  { id: "ads", label: "广告投放" },
  { id: "brand", label: "品牌视觉" },
];

export const SHOOT_GOAL_OPTIONS = [
  { id: "conversion", label: "促进转化" },
  { id: "premium", label: "建立质感" },
  { id: "explain", label: "解释功能" },
  { id: "launch", label: "新品传播" },
];

export const SHOOT_USE_CASE_LABELS = Object.fromEntries(
  SHOOT_USE_CASE_OPTIONS.map((item) => [item.id, item.label]),
);

export const SHOOT_GOAL_LABELS = Object.fromEntries(
  SHOOT_GOAL_OPTIONS.map((item) => [item.id, item.label]),
);

// 拍摄方向 = 整套视觉基调。scene / tone 只是它在通用状态里的存储键；
// 写进提示词的是 look：只决定光线、色调和质感，不把所有张锁进同一个布景。
export const SHOOT_DIRECTION_OPTIONS = [
  {
    id: "studio",
    label: "干净棚拍",
    hint: "主图、官网首屏",
    scene: "纯色影棚",
    tone: "极简高级",
    look: "干净棚拍——专业影棚布光：大面积柔光主光加轮廓光，背景为纯色或柔和渐变的无缝背景，色彩干净克制，材质反射真实。",
  },
  {
    id: "lifestyle",
    label: "生活场景",
    hint: "种草、使用情境",
    scene: "家居生活",
    tone: "真实自然",
    look: "生活场景——自然窗光或温暖环境光，色调温和自然，画面有真实生活的空气感和细节，像实拍而不是渲染。",
  },
  {
    id: "premium",
    label: "高级质感",
    hint: "材质、工艺卖点",
    scene: "纯色影棚",
    tone: "轻奢质感",
    look: "高级质感——低调深色背景配精准侧光或顶光，强调材质纹理、边缘高光和工艺细节，整体克制、有品牌感。",
  },
  {
    id: "concept",
    label: "概念创意",
    hint: "新品、广告投放",
    scene: "科技空间",
    tone: "科技未来",
    look: "概念创意——有设计感的抽象布景（几何台面、色块、光影造型），色彩大胆但克制，适合广告与新品传播；不要科幻太空、外星场景或赛博霓虹。",
  },
];

export function shootDirectionFor(scene, tone) {
  return (
    SHOOT_DIRECTION_OPTIONS.find(
      (item) => item.scene === scene && item.tone === tone,
    ) || null
  );
}

// AI 商拍的整套规则：写在每张图的基础提示词里（每张职责另由镜头目录补充）
export function shootPromptLines(direction) {
  return [
    "这是真实相机拍摄质感的商业商品摄影，不是插画、海报或 3D 渲染；按商品本身的真实材质还原。",
    direction
      ? `整套视觉基调：${direction.look}基调只决定光线、色调和质感；每张的具体场景、景别和机位以“本张输出职责”为准，不要把所有张放进同一个布景。`
      : "",
    "整套每一张必须有明显不同的景别、机位和构图，不能只是同一张图换背景。",
    "商品只能出现一次，不添加文字、水印、Logo 贴纸或无关商品。",
  ].filter(Boolean);
}

// “必须保留的元素”按中英文逗号、顿号、分号拆成条目，用于画布上的摘要
export function shootProtectedItems(value) {
  return String(value || "")
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 镜头按目录顺序排列：第 1 个镜头就是整套的定调首张
export function toggleShootShot(current, id, max = SHOOT_MAX_SHOTS) {
  const selected = new Set(current);
  if (selected.has(id)) {
    if (selected.size <= 1) return current;
    selected.delete(id);
  } else {
    if (selected.size >= max) return current;
    selected.add(id);
  }
  return CREATIVE_SHOOT_SHOTS.map((shot) => shot.id).filter((shotId) =>
    selected.has(shotId),
  );
}

export function useShootBusinessState() {
  const [shootUseCase, setShootUseCase] = useState("listing");
  const [shootGoal, setShootGoal] = useState("conversion");
  const [shootAudience, setShootAudience] = useState("");
  const [shootSku, setShootSku] = useState("");
  const [shootProtectedElements, setShootProtectedElements] = useState(
    SHOOT_DEFAULT_PROTECTED_ELEMENTS,
  );
  const [shootShotIds, setShootShotIds] = useState([...SHOOT_DEFAULT_SHOT_IDS]);
  const shootBlueprints = useMemo(
    () =>
      shootShotIds
        .map((id) => CREATIVE_SHOOT_SHOTS.find((shot) => shot.id === id))
        .filter(Boolean),
    [shootShotIds],
  );

  return {
    shootUseCase,
    setShootUseCase,
    shootGoal,
    setShootGoal,
    shootAudience,
    setShootAudience,
    shootSku,
    setShootSku,
    shootProtectedElements,
    setShootProtectedElements,
    shootShotIds,
    setShootShotIds,
    shootBlueprints,
    toggleShootShot: (id) =>
      setShootShotIds((current) => toggleShootShot(current, id)),
  };
}
