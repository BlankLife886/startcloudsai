// 虚拟试衣出图机位。
//
// 设计原则：
// 1. 按用途分套：上架套图服务商品详情页（前/后/侧/细节缺一不可），
//    种草氛围服务社媒投放（生活感、动态、情绪）。两套不混用。
// 2. 按服装类型取景：上装、下装、连衣裙/全身、套装的看点不同，
//    同一个机位会换景别和重点部位。
// 3. 每张写清景别、机位、姿势、场景占比、用途和“与其他张的区别”，
//    从提示词层面杜绝两张图雷同。

// 背景：场景图（第 3 张参考图提供环境）或纯白棚拍（不发送场景图）。
// 纯白棚拍满足亚马逊等平台主图“纯白背景、真人正面站姿、占画面 85% 以上”的要求。
export const TRYON_BACKDROPS = [
  { id: "scene", label: "场景图" },
  { id: "white", label: "纯白棚拍" },
];

const WHITE_STUDIO_SCENE =
  "纯白无缝背景（RGB 255,255,255），背景干净无纹理、无道具、无文字，均匀柔和的棚拍布光，只保留脚下自然的轻微接触阴影";

export const TRYON_WHITE_STUDIO_PROMPT =
  "背景与光线：纯白无缝棚拍。背景必须是纯白（RGB 255,255,255），不得出现任何场景、墙面纹理、道具、文字或水印；使用大面积柔光箱的均匀商业棚拍布光，面料质感清晰，只保留脚下自然的轻微接触阴影。";

export function tryonWhiteTaskPrompt(outfit = false) {
  return outfit
    ? "将第 1 张参考图中的上装与第 3 张参考图中的下装同时准确穿到第 2 张参考图中的同一位模特身上，在纯白棚拍背景中拍摄。必须保持第 2 张模特的脸型、五官、肤色、年龄感、发型和体型，禁止换成相似路人。保持两件服装的款式、颜色、图案、剪裁、材质和垂坠感一致。输出全画幅相机实拍的电商时装摄影，禁止CG、塑料感和过度磨皮。"
    : "将第 1 张参考图中的服装准确穿到第 2 张参考图中的同一位模特身上，在纯白棚拍背景中拍摄。必须保持第 2 张模特的脸型、五官、肤色、年龄感、发型和体型，禁止换成相似路人。保持服装款式、颜色、图案、剪裁、材质和垂坠感一致。输出全画幅相机实拍的电商时装摄影，保留面料织纹、缝线、褶皱与真实光影，禁止CG、塑料感和过度磨皮，不改变服装设计。";
}

export function tryonWhiteReferenceRoles(outfit = false) {
  return outfit
    ? ["上装身份", "模特身份", "下装身份"]
    : ["服装身份", "模特身份"];
}

export function tryonWhiteIdentityLock(outfit = false) {
  return outfit
    ? "套装身份锁：第 1 张是上装身份，第 3 张是下装身份，两件都锁定版型、长度、领口、袖型、腰头、裤脚或裙摆、图案、颜色、面料与缝线，必须同时穿在同一人身上，不得合并成一件或替换其中之一；第 2 张是模特身份，必须是同一人，锁定脸型、五官比例、肤色、年龄感、发型和体型。背景固定为纯白棚拍。姿势与机位可以变化，人物身份和服装设计不可变化。"
    : "双身份锁：第 1 张是服装身份，锁定版型、长度、领口、袖型、图案、颜色、面料与缝线；第 2 张是模特身份，必须是同一人，锁定脸型、五官比例、肤色、年龄感、发型和体型，禁止生成另一个相似的人。背景固定为纯白棚拍。姿势与机位可以变化，人物身份和服装设计不可变化。";
}

export const TRYON_SHOT_PACKS = [
  { id: "single", label: "单张主图", count: 1 },
  { id: "set", label: "上架套图", count: 4, hint: "正面 / 背面 / 侧身 / 特写" },
  { id: "social", label: "种草氛围", count: 4, hint: "行走 / 回眸 / 近景 / 坐姿" },
];

export function tryonShotPackById(id) {
  return TRYON_SHOT_PACKS.find((pack) => pack.id === id) || TRYON_SHOT_PACKS[0];
}

function apparelKind(apparel) {
  const value = String(apparel || "");
  if (value === "上装") return "top";
  if (value === "下装") return "bottom";
  if (value === "套装") return "outfit";
  return "full";
}

const FRONT_FRAMING = {
  top: "七分身：从头顶到大腿中部，上衣占画面主要面积，领口、肩线、衣长和下摆清晰可见",
  bottom: "全身：头到鞋完整入画，腰线到裤脚/裙摆位于画面中心区域，上身穿着简洁不抢戏",
  full: "全身：头顶到鞋子完整入画，人物高度约占画面 80%，衣长和廓形一眼看全",
  outfit: "全身：头顶到鞋子完整入画，上装与下装的比例、塞衣与腰线关系完整呈现",
};

const BACK_FOCUS = {
  top: "后领、肩背、后片衣长与下摆",
  bottom: "后腰、后口袋、臀部版型与裤腿/裙摆后侧",
  full: "后背设计、开口/拉链、后腰线与裙摆后侧",
  outfit: "上装后片与下装后腰的衔接、臀部版型",
};

const DETAIL_FOCUS = {
  top: "领口、袖口、门襟或纽扣",
  bottom: "腰头、口袋、裤脚或裙摆边",
  full: "腰线、领口与裙摆面料",
  outfit: "上下装交接处（塞衣/腰带）与主要面料",
};

const CLOSE_FRAMING = {
  top: "腰部以上半身近景，脸部与上衣同框",
  bottom: "侧坐或倚靠的全身/七分身，展示下装在坐姿下的垂感与褶皱",
  full: "胸部以上到膝盖的中近景，脸部与服装上半部分同框",
  outfit: "腰部以上半身近景，上装与下装腰头同框",
};

// 每个机位自带镜头（真实商拍按景别换镜头），不再让用户全局选一个焦距
const LENSES = {
  portrait: "约 85mm f/2 人像镜头，轻微压缩透视，人体比例自然不变形，背景柔和虚化",
  macro: "约 100mm 微距镜头，贴近拍摄，织纹与走线锐利，景深极浅",
  environment: "约 35mm 人文镜头，带出环境纵深，人物位于画面安全区内避免边缘畸变",
  normal: "约 50mm 标准镜头，透视接近人眼，自然松弛",
};

function shot(id, label, parts, backdrop = "scene") {
  if (backdrop === "white") {
    parts = { ...parts, scene: WHITE_STUDIO_SCENE };
  }
  return {
    id,
    label,
    direction: [
      `景别与机位：${parts.frame}`,
      `镜头：${LENSES[parts.lens || "portrait"]}`,
      `姿势：${parts.pose}`,
      `场景：${parts.scene}`,
      `用途：${parts.purpose}`,
      `与其他机位的区别：${parts.unlike}`,
    ].join("。") + "。",
  };
}

function frontShot(kind, backdrop) {
  return shot("front", "正面主图", {
    lens: "portrait",
    frame: `${FRONT_FRAMING[kind]}；机位平视胸口高度，人物居中${backdrop === "white" ? "，服装与人物合计占画面不少于 85%" : ""}`,
    pose: "静态自然站姿，身体正对镜头，重心稳定，双臂自然下垂或轻搭，不遮挡服装任何部位，表情自然放松",
    scene: "第 3 张场景只作为浅景深的虚化背景，按商业时装摄影布光，主体与背景有清晰的光学分离",
    purpose: "电商首图：端正、完整地展示服装正面版型、颜色与图案",
    unlike: "正面、静止、不侧身、不走动、不做特写",
  }, backdrop);
}

function listingShots(kind, backdrop) {
  return [
    frontShot(kind, backdrop),
    shot("back", "背面", {
      lens: "portrait",
      frame: "全身，机位平视腰部高度，人物背对镜头",
      pose: "背对镜头自然站立，可轻微回头露出侧脸，双臂不遮挡后背",
      scene: "背景虚化，与正面主图保持同一光线和色调",
      purpose: `展示背面设计：${BACK_FOCUS[kind]}`,
      unlike: "身体必须背对镜头，不能出现正面或 45° 侧身",
    }, backdrop),
    shot("angle", "45° 侧身", {
      lens: "portrait",
      frame: "全身，机位平视，人物身体转向约 45°",
      pose: "三分之四侧身站立或迈出半步，一侧手臂略微离开身体，露出侧面腰线",
      scene: "背景虚化，与正面主图保持同一光线和色调",
      purpose: "展示侧面轮廓、合身度与垂坠感",
      unlike: "明确的 45° 斜侧，既不是正面也不是背面",
    }, backdrop),
    shot("detail", "工艺特写", {
      lens: "macro",
      frame: "局部特写，镜头贴近服装，占满画面，微距般清晰",
      pose: `模特的手自然触碰或轻拎${DETAIL_FOCUS[kind]}，手部姿态真实`,
      scene: "背景几乎不可见，仅保留柔和虚化",
      purpose: `展示做工与面料：${DETAIL_FOCUS[kind]}的织纹、走线和质感，不改变任何设计`,
      unlike: "只拍局部，画面中不得出现完整人物",
    }, backdrop),
  ];
}

function socialShots(kind, backdrop) {
  return [
    shot("walk", "行走抓拍", {
      lens: "environment",
      frame: "中远景全身，人物高度约占画面 50%，机位略低，人物可偏离画面中心",
      pose: "自然行走中的一步，身体略有前倾，服装随步伐产生真实摆动和褶皱，眼神不看镜头",
      scene: "第 3 张场景清晰可辨，是画面的重要组成部分，有纵深与环境光",
      purpose: "社媒种草：真实生活中的穿着状态与氛围",
      unlike: "必须在走动、人物较小、场景占比大，不能是静态站姿",
    }, backdrop),
    shot("glance", "回眸", {
      lens: "portrait",
      frame: "七分身，机位在人物侧后方",
      pose: "身体朝向画面深处，转头回望镜头，头发或衣摆带有轻微动态",
      scene: "场景适度可见，浅景深",
      purpose: "情绪感与记忆点，同时带出服装侧后方的线条",
      unlike: "侧后方机位加回头动作，与正面和行走都不同",
    }, backdrop),
    shot("close", kind === "bottom" ? "坐姿垂感" : "半身氛围", {
      lens: kind === "bottom" ? "normal" : "portrait",
      frame: `${CLOSE_FRAMING[kind]}，机位与视线齐平`,
      pose:
        kind === "bottom"
          ? "侧坐在场景中的台阶、椅子或矮墙上，双腿自然交叠或前伸，展示面料在坐姿下的垂感"
          : "肩部放松，手可轻触头发、领口或衣襟，表情自然有情绪",
      scene: "背景浅景深虚化，保留场景的色彩氛围",
      purpose: "拉近距离，突出上身效果与人物气质",
      unlike: "明显更近的景别，脸与服装同框，不是全身",
    }, backdrop),
    shot("lean", kind === "bottom" ? "倚靠站姿" : "坐姿倚靠", {
      lens: "normal",
      frame: "七分身或全身，机位略高于视线",
      pose:
        kind === "bottom"
          ? "单肩倚靠墙面或栏杆，一条腿微曲交叉，展示下装在放松站姿下的版型"
          : "坐在或倚靠场景中的物件上，身体呈放松的 S 形，服装在动作下形成自然褶皱",
      scene: "场景中的真实物件参与构图，环境清晰",
      purpose: "日常松弛感，展示服装在非站立姿态下的表现",
      unlike: "身体与场景物件有接触、姿态放松，与行走和回眸都不同",
    }, backdrop),
  ];
}

export function tryonShotBlueprints(
  packId = "single",
  apparel = "全身",
  backdrop = "scene",
) {
  const kind = apparelKind(apparel);
  const bd = backdrop === "white" ? "white" : "scene";
  if (packId === "set") return listingShots(kind, bd);
  if (packId === "social") return socialShots(kind, bd);
  return [frontShot(kind, bd)];
}
