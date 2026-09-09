export const DEMO_SKILLS = [
  {
    id: "product-shot",
    name: "商品主图策划",
    category: "图像创作",
    description: "把商品特点，变成有画面感的主图方案。",
    cover: "/sucai/studio-cover-ecom-create.webp",
    icon: "shopping",
    outputLabel: "主图方案",
    deliverables: ["视觉方向", "构图与灯光", "生图提示词"],
    fields: [
      {
        key: "product",
        label: "你的商品",
        placeholder: "例如：一款米白色陶瓷咖啡杯，杯身有细腻的竖纹",
        required: true,
        type: "textarea",
      },
      {
        key: "details",
        label: "想强调的特点",
        placeholder: "填写已确认的特点或使用场景，不确定的可以先留空",
        required: false,
        type: "textarea",
      },
      {
        key: "style",
        label: "视觉风格",
        placeholder: "选择视觉风格",
        required: true,
        type: "select",
        options: ["简洁棚拍", "自然生活", "高端商业"],
      },
    ],
    example: {
      product: "米白色陶瓷咖啡杯，杯身有细腻的竖纹",
      details: "希望展示竖纹细节，用于咖啡器具店铺的商品首图",
      style: "自然生活",
    },
  },
  {
    id: "prompt-refine",
    name: "生图提示词优化",
    category: "图像创作",
    description: "从一句灵感出发，整理更清楚的画面表达。",
    cover: "/sucai/studio-cover-t2i.webp",
    icon: "image",
    outputLabel: "生图提示词",
    deliverables: ["完整提示词", "画面约束", "参数建议"],
    fields: [
      {
        key: "idea",
        label: "想画什么",
        placeholder: "例如：雨后街角的一间花店，门口停着一辆自行车",
        required: true,
        type: "textarea",
      },
      {
        key: "constraints",
        label: "补充偏好",
        placeholder: "例如：保留柔和的灯光，画面里不要出现人物",
        required: false,
        type: "textarea",
      },
      {
        key: "style",
        label: "画面风格",
        placeholder: "选择画面风格",
        required: true,
        type: "select",
        options: ["电影摄影", "手绘插画", "写实摄影"],
      },
    ],
    example: {
      idea: "雨后街角的一间花店，门口停着一辆自行车，路面有细微倒影",
      constraints: "温柔安静的夜晚，保留橱窗暖光，不出现人物和文字",
      style: "电影摄影",
    },
  },
  {
    id: "character-sheet",
    name: "角色设定",
    category: "图像创作",
    description: "梳理外形、气质与细节，让角色更加鲜明。",
    cover: "/sucai/studio-cover-model.webp",
    icon: "character",
    outputLabel: "角色设定稿",
    deliverables: ["角色定位", "外形设定", "多视角要求"],
    fields: [
      {
        key: "character",
        label: "角色想法",
        placeholder: "例如：一位穿梭在空中岛屿之间的年轻邮差",
        required: true,
        type: "textarea",
      },
      {
        key: "details",
        label: "需要保留的设定",
        placeholder: "例如：深绿色披风、旧邮包，性格好奇而认真",
        required: false,
        type: "textarea",
      },
      {
        key: "style",
        label: "美术风格",
        placeholder: "选择美术风格",
        required: true,
        type: "select",
        options: ["清新插画", "动画概念", "写实概念"],
      },
    ],
    example: {
      character: "一位穿梭在空中岛屿之间的年轻邮差",
      details: "深绿色短披风、旧邮包，性格好奇而认真，整体轻盈利落",
      style: "动画概念",
    },
  },
  {
    id: "color-palette",
    name: "灵感配色",
    category: "设计策划",
    description: "找到一组协调的颜色，给灵感定下基调。",
    cover: "/sucai/studio-cover-coloring.webp",
    icon: "palette",
    outputLabel: "配色方案",
    deliverables: ["五色配色", "使用比例", "搭配建议"],
    fields: [
      {
        key: "scene",
        label: "用在哪里",
        placeholder: "例如：一个介绍植物与慢生活的品牌网站",
        required: true,
        type: "textarea",
      },
      {
        key: "notes",
        label: "补充想法",
        placeholder: "例如：需要大面积浅色，阅读起来轻松、舒服",
        required: false,
        type: "textarea",
      },
      {
        key: "mood",
        label: "色彩氛围",
        placeholder: "选择色彩氛围",
        required: true,
        type: "select",
        options: ["自然柔和", "清新明亮", "温暖复古"],
      },
    ],
    example: {
      scene: "一个介绍植物与慢生活的品牌网站",
      notes: "大面积浅色，配少量植物绿，整体有呼吸感",
      mood: "自然柔和",
    },
  },
  {
    id: "brand-copy",
    name: "品牌文案",
    category: "设计策划",
    description: "整理品牌想说的话，让表达更有自己的气质。",
    cover: "/sucai/studio-cover-ui.webp",
    icon: "copy",
    outputLabel: "文案草稿",
    deliverables: ["主题标题", "介绍文案", "行动引导"],
    fields: [
      {
        key: "brand",
        label: "品牌或项目名称",
        placeholder: "例如：留白咖啡",
        required: true,
        type: "textarea",
      },
      {
        key: "context",
        label: "这次想表达什么",
        placeholder: "介绍产品、活动或理念，写下已确认的信息即可",
        required: true,
        type: "textarea",
      },
      {
        key: "tone",
        label: "表达语气",
        placeholder: "选择表达语气",
        required: true,
        type: "select",
        options: ["温柔自然", "简洁克制", "轻松活泼"],
      },
    ],
    example: {
      brand: "留白咖啡",
      context: "周末开放一场手冲咖啡分享，邀请附近的人来坐坐、聊聊自己的生活",
      tone: "温柔自然",
    },
  },
  {
    id: "document-summary",
    name: "资料要点提炼",
    category: "日常效率",
    description: "粘贴一段资料，预览更便于阅读的整理方式。",
    cover: "/sucai/studio-cover-assistant.webp",
    icon: "document",
    outputLabel: "资料整理稿",
    deliverables: ["原文摘录", "阅读提纲", "整理建议"],
    fields: [
      {
        key: "source",
        label: "粘贴资料",
        placeholder: "粘贴会议记录、文章片段或项目说明，体验整理效果",
        required: true,
        type: "textarea",
      },
      {
        key: "focus",
        label: "重点关注什么",
        placeholder: "例如：活动安排、负责人或下一步事项",
        required: false,
        type: "textarea",
      },
      {
        key: "format",
        label: "整理用途",
        placeholder: "选择整理用途",
        required: true,
        type: "select",
        options: ["快速阅读", "会议回顾", "项目备忘"],
      },
    ],
    example: {
      source:
        "我们计划在十月举办一次社区摄影分享会。活动以城市日常为主题，每位参与者可以带来三张作品。场地正在联系中，确定后由小林整理报名说明。下一次讨论安排在下周三，主要确认场地、人数和作品展示方式。",
      focus: "活动安排与后续需要确认的事情",
      format: "会议回顾",
    },
  },
];

const COLOR_PALETTES = {
  自然柔和: [
    { name: "纸白", hex: "#F4F2EB" },
    { name: "浅砂", hex: "#DAD5C8" },
    { name: "鼠尾草", hex: "#A5B29A" },
    { name: "苔绿", hex: "#687A62" },
    { name: "松影", hex: "#2F4037" },
  ],
  清新明亮: [
    { name: "云白", hex: "#F4F8FC" },
    { name: "晴空", hex: "#D8E9F6" },
    { name: "浅蓝", hex: "#A3C5E1" },
    { name: "湖蓝", hex: "#4D87B1" },
    { name: "深海", hex: "#24445D" },
  ],
  温暖复古: [
    { name: "奶油", hex: "#F7EFE2" },
    { name: "杏仁", hex: "#E4CDB1" },
    { name: "陶土", hex: "#C59072" },
    { name: "栗棕", hex: "#92604A" },
    { name: "深可可", hex: "#49382F" },
  ],
};

function valueOf(values, key, fallback = "") {
  return String(values?.[key] ?? "").trim() || fallback;
}

function productResult(values) {
  const product = valueOf(values, "product", "你的商品");
  const details = valueOf(values, "details");
  const style = valueOf(values, "style", "简洁棚拍");
  const direction =
    {
      简洁棚拍: "浅色无缝背景，减少道具，让商品轮廓和真实细节成为画面的重点",
      自然生活:
        "自然窗光与简洁的日常环境，借助轻柔阴影营造轻松、真实的使用氛围",
      高端商业: "克制的背景与有方向感的布光，用清楚的明暗层次呈现商品形态",
    }[style] || "简洁背景与柔和光线，优先呈现商品本身";
  return {
    title: "商品主图 · 视觉策划",
    summary: `围绕「${product}」，整理一份${style}方向的文字方案，可作为后续拍摄或生图的起点。`,
    sections: [
      {
        title: "01 / 视觉方向",
        body: `${direction}。${details ? `本次表达重点：${details}。` : "尚未填写卖点，方案先聚焦商品外观，不补充未经确认的功能与材质。"}道具只用于交代环境，避免遮挡商品或引入容易误解的使用效果。`,
      },
      {
        title: "02 / 构图与灯光",
        bullets: [
          "建议先尝试 1:1 构图，商品占据画面主体，四周留出适当空间。",
          "用侧前方柔光表现轮廓，保留自然接触阴影；关键细节另做近景验证。",
          "主图先保持无文字，需要排版时再根据实际平台要求补充信息。",
        ],
      },
      {
        title: "03 / 生图提示词",
        body: `${product}，${style}，${direction}，主体清晰，构图有序，细节自然，真实接触阴影。${details ? `明确需求：${details}。` : ""}不添加未提供的商品规格、品牌标识或宣传字样。涉及外观还原时，需要补充真实商品参考图。`,
      },
    ],
  };
}

function promptResult(values) {
  const idea = valueOf(values, "idea", "你的画面想法");
  const constraints = valueOf(values, "constraints");
  const style = valueOf(values, "style", "电影摄影");
  const expression =
    {
      电影摄影:
        "自然的镜头透视，明确的主体层次，柔和而有方向的光线，协调的电影色调",
      手绘插画: "有节奏的线条，清楚的形状组织，适量手绘笔触，统一的插画色彩",
      写实摄影:
        "可信的材质纹理，自然的空间透视，克制的后期质感，合理的光影关系",
    }[style] || "清楚的主体层次，协调的色彩与自然光影";
  return {
    title: "生图提示词 · 整理稿",
    summary: `保留你的画面想法，按${style}方向补充表达层次。以下为可编辑的演示提示词。`,
    sections: [
      {
        title: "01 / 完整提示词",
        body: `${idea}。采用${style}风格，${expression}。让视觉重心围绕原始主体展开，前景、中景与背景保持适当区分，画面细节服务于主题，避免无关元素。${constraints ? `必须遵守：${constraints}。` : "未指定的角色、文字和装饰暂不额外添加。"}`,
      },
      {
        title: "02 / 画面约束",
        bullets: [
          `主体与内容以「${idea}」为准，新增构图建议可按实际需要删改。`,
          constraints
            ? `保留你的补充偏好：${constraints}。`
            : "正式生成前可以补充需要保留、排除的元素，减少反复调整。",
          "检查重复主体、异常结构与不必要的文字；这些是生成建议，不能保证模型完全遵循。",
        ],
      },
      {
        title: "03 / 起步参数",
        body: "先用常规画质试一张，确认方向后再提高分辨率。场景展示可尝试 4:3，横幅用途可尝试 16:9，最终以画面内容和使用位置为准。此处只整理文字，尚未生成图片。",
      },
    ],
  };
}

function characterResult(values) {
  const character = valueOf(values, "character", "你的角色");
  const details = valueOf(values, "details");
  const style = valueOf(values, "style", "动画概念");
  return {
    title: "角色设定 · 创作简报",
    summary: `以「${character}」为起点，整理${style}方向的设定要求，方便后续逐步完善角色。`,
    sections: [
      {
        title: "01 / 角色定位",
        body: `核心设定：${character}。${details ? `已确认的细节：${details}。` : "年龄、服装、配饰与性格尚待补充，当前不替你确定。"}先让轮廓与姿态传达角色身份，再逐步加入细节。以下内容是创作建议，具体外形仍由你决定。`,
      },
      {
        title: "02 / 设计重点",
        bullets: [
          "先确定一个容易识别的主体轮廓，让服装层次与道具围绕它展开。",
          "配色建议从主色、辅色与少量点缀色开始，具体色值确认后再用于所有视图。",
          "同一件服装的接缝、开合方式和配饰位置保持一致，避免各视图分别添加装饰。",
        ],
      },
      {
        title: "03 / 设定板要求",
        body: `${style}角色设定板，内容为：${character}。${details ? `保留：${details}。` : ""}展示正面、侧面与背面，统一身高、身体比例、服装结构与光线，采用简洁背景。姿势以便于观察结构为主；未确认的细节先留作讨论，不把建议当作既定设定。`,
      },
    ],
  };
}

function colorResult(values) {
  const scene = valueOf(values, "scene", "你的设计");
  const notes = valueOf(values, "notes");
  const mood = valueOf(values, "mood", "自然柔和");
  const palette = COLOR_PALETTES[mood] || COLOR_PALETTES.自然柔和;
  return {
    title: "灵感配色 · 五色方案",
    summary: `为「${scene}」展示一组${mood}方向的示例配色，色值可复制后继续调整。`,
    palette,
    sections: [
      {
        title: "01 / 色彩方向",
        body: `以${palette[0].name}作为底色，搭配${palette[2].name}建立整体气质，再用${palette[4].name}稳定阅读与视觉重点。${notes ? `你的补充想法：${notes}。` : "建议先在一张真实页面或一幅草图上试色，再判断是否需要提高明暗对比。"}这组颜色用于演示搭配方式，尚未分析具体图片。`,
      },
      {
        title: "02 / 使用比例",
        bullets: [
          `背景约 60%：${palette[0].name}与${palette[1].name}，用于页面底色、大面积留白或环境色。`,
          `辅助约 30%：${palette[2].name}，用于分区、图形和视觉过渡。`,
          `强调约 10%：${palette[3].name}与${palette[4].name}，用于重点和小面积点缀，可随内容调整。`,
        ],
      },
      {
        title: "03 / 应用建议",
        body: "文字优先使用最深色，浅色之间主要用于营造层次。按钮、正文与提示信息需要在实际背景上单独检查可读性；这组示例未经过对比度验证。若用于插画，可从同一主色延伸明暗，避免每个物体使用独立的一套色相。",
      },
    ],
  };
}

function brandResult(values) {
  const brand = valueOf(values, "brand", "你的品牌");
  const context = valueOf(values, "context", "介绍这次希望传达的内容");
  const tone = valueOf(values, "tone", "温柔自然");
  const phrasing = {
    温柔自然: {
      headline: "为日常，留一点喜欢的时间。",
      closing: "从这里，了解更多。",
      opening: "我们想把这份小小的期待，与你分享。",
    },
    简洁克制: {
      headline: "把心意，放进每一个细节。",
      closing: "查看具体安排。",
      opening: "从一件具体的事开始，把想法说清楚。",
    },
    轻松活泼: {
      headline: "给今天，加一点新鲜感。",
      closing: "一起看看吧。",
      opening: "最近有个新想法，想邀请你来看看。",
    },
  }[tone] || {
    headline: "让想法，有自己的表达。",
    closing: "了解更多。",
    opening: "这次，我们想与你分享。",
  };
  return {
    title: "品牌文案 · 表达草稿",
    summary: `为「${brand}」整理一份${tone}语气的示例文案，方便快速预览标题、正文和按钮的搭配。`,
    sections: [
      { title: "01 / 主题标题", body: `${brand} · ${phrasing.headline}` },
      {
        title: "02 / 介绍文案",
        body: `${phrasing.opening}\n\n${context}\n\n${brand}，${phrasing.headline}`,
      },
      {
        title: "03 / 行动引导",
        body: `按钮建议：「${phrasing.closing.replace(/[。！]/g, "")}」。点击后应进入与本次内容对应的介绍或报名位置。正式使用前，补充你已确认的时间、地点、价格或参与方式；没有提供的信息不在草稿里补写。`,
      },
      {
        title: "04 / 使用建议",
        bullets: [
          "标题负责传达感受，正文保留具体信息，避免把重要条件只放在图片里。",
          "通用标题只是演示方向，可加入品牌自己的常用表达，让语气更有辨识度。",
          "将确定的卖点写具体，避免加入未经证实的效果、承诺或用户评价。",
        ],
      },
    ],
  };
}

function documentResult(values) {
  const source = valueOf(values, "source");
  const focus = valueOf(values, "focus");
  const format = valueOf(values, "format", "快速阅读");
  const excerpts = source
    .split(/(?<=[。！？!?；;])\s*|\n+/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  return {
    title: `资料整理 · ${format}`,
    summary:
      "下面按原文顺序展示前 3 个内容片段，帮助你预览整理稿的样式。此演示未进行智能摘要或事实核查。",
    sections: [
      {
        title: "01 / 原文摘录",
        bullets: excerpts.length
          ? excerpts
          : ["尚未填写资料，请先粘贴原文后再预览。"],
      },
      {
        title: "02 / 阅读提纲",
        body: `${focus ? `你希望重点关注：${focus}。` : "你尚未指定关注重点，可先从主题、已确认信息与待确认事项三个方向阅读。"}以上摘录保留原文顺序，不代表已筛选出最重要的信息。正式整理时，应结合上下文重新判断，避免用单句代替原文结论。`,
      },
      {
        title: "03 / 整理建议",
        bullets: [
          "先标记原文明确写出的安排、日期与参与者；原文没有的信息保持空缺。",
          "把已经确定的事项与仍在讨论的内容分开记录，保留原文中的条件和不确定表述。",
          "涉及后续行动时，只有原文明确说明后才填写负责人和时间，不自行补全。",
        ],
      },
      {
        title: "04 / 原文核对",
        body: `这份${format}演示仅使用你粘贴的文本，不读取附件，也不添加外部资料或引用。复制整理稿后，建议回到完整原文逐条检查；超过当前摘录范围的内容仍需继续阅读。`,
      },
    ],
  };
}

const RESULT_BUILDERS = {
  "product-shot": productResult,
  "prompt-refine": promptResult,
  "character-sheet": characterResult,
  "color-palette": colorResult,
  "brand-copy": brandResult,
  "document-summary": documentResult,
};

export function buildDemoSkillResult(skill, values = {}) {
  const buildResult = RESULT_BUILDERS[skill?.id];
  if (!buildResult) throw new Error("请选择一个演示 Skill");

  const result = buildResult(values);
  const text = [
    "Skill 中心演示结果",
    "仅用于功能预览，未调用 AI。文中建议与示例请在确认后使用。",
    "",
    result.title,
    result.summary,
    ...(result.palette
      ? [
          "",
          "示例配色",
          ...result.palette.map((color) => `${color.name} · ${color.hex}`),
        ]
      : []),
    ...result.sections.flatMap((section) => [
      "",
      section.title,
      ...(section.body ? [section.body] : []),
      ...(section.bullets || []).map((bullet) => `• ${bullet}`),
    ]),
  ].join("\n");

  return { ...result, text };
}
