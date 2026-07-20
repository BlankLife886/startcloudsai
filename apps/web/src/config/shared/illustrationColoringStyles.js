export const DEFAULT_COLORING_STYLE_CATEGORIES = [
  {
    id: "base",
    label: "基础插画",
    icon: "bi-palette2",
    hint: "通用染色、绘本、矢量、手账和厚涂",
  },
  {
    id: "person",
    label: "人物",
    icon: "bi-person-bounding-box",
    hint: "肤色、五官、发丝、角色气质",
  },
  {
    id: "landscape",
    label: "风景",
    icon: "bi-mountains",
    hint: "天空、自然、城市、远近层次",
  },
  {
    id: "animal",
    label: "动物",
    icon: "bi-hearts",
    hint: "毛发、羽毛、鳞片、宠物和野生动物",
  },
  {
    id: "portrait",
    label: "写真",
    icon: "bi-camera",
    hint: "镜头感、影棚、人像和产品写真",
  },
  {
    id: "lighting",
    label: "光影",
    icon: "bi-brightness-high",
    hint: "主光、逆光、夜景、体积光和戏剧阴影",
  },
  {
    id: "glamour",
    label: "轻暴露",
    icon: "bi-gem",
    hint: "成人时装、泳装、优雅轻性感，保持非露骨",
  },
  {
    id: "space",
    label: "场景空间",
    icon: "bi-grid-1x2",
    hint: "室内、建筑、空间透视和材质分区",
  },
  {
    id: "linear",
    label: "线性插画",
    icon: "bi-vector-pen",
    hint: "保留线条、轻色块、编辑插画和白底表现",
  },
  {
    id: "historical",
    label: "历史年代",
    icon: "bi-hourglass-split",
    hint: "古风、民国、复古海报、旧照片和年代质感",
  },
  {
    id: "future",
    label: "未来科技",
    icon: "bi-cpu",
    hint: "赛博、机甲、HUD、金属和冷光科技感",
  },
  {
    id: "anime",
    label: "动漫",
    icon: "bi-stars",
    hint: "赛璐璐、主视觉、少女漫画、动画电影感",
  },
  {
    id: "game",
    label: "游戏",
    icon: "bi-controller",
    hint: "概念设计、装备、怪物、场景和像素风",
  },
  {
    id: "model",
    label: "模型",
    icon: "bi-box",
    hint: "手办、3D、工业模型、材质球和棚拍",
  },
  {
    id: "ecommerce",
    label: "电商",
    icon: "bi-bag-check",
    hint: "商品主图、包装、卖点和商业干净背景",
  },
  {
    id: "fashion",
    label: "穿衣风格",
    icon: "bi-handbag",
    hint: "服装配色、面料、街拍、礼服和穿搭",
  },
  {
    id: "real-person",
    label: "真人",
    icon: "bi-person-video3",
    hint: "真人肤质、生活照片、写实人物和自然镜头",
  },
  {
    id: "custom",
    label: "自定义",
    icon: "bi-pencil-square",
    hint: "自行描述配色、光影、材质和氛围",
  },
];

const LEGACY_STYLE_CATEGORY_BY_ID = {
  watercolor: "base",
  anime: "anime",
  warm: "base",
  dreamy: "lighting",
  storybook: "historical",
  "ink-wash": "historical",
  "pastel-marker": "base",
  "flat-vector": "linear",
  "cinematic-neon": "future",
  "oil-paint": "base",
  "portrait-skin-tone": "person",
  "landscape-atmosphere": "landscape",
  "animal-soft-fur": "animal",
  "photo-realistic": "portrait",
  "dramatic-lighting": "lighting",
  "soft-glamour": "glamour",
  "interior-space": "space",
  "linear-editorial": "linear",
  "historical-period": "historical",
  "future-tech": "future",
  "anime-key-visual": "anime",
  "game-concept": "game",
  "model-render": "model",
  "ecommerce-product": "ecommerce",
  "fashion-outfit": "fashion",
  custom: "custom",
};

const RAW_DEFAULT_COLORING_STYLE_PRESETS = [
  {
    id: "watercolor",
    label: "清新水彩",
    hint: "柔和晕染、留白自然，适合童书与植物线稿",
    icon: "bi-droplet-half",
    prompt:
      "Color this line art illustration with soft watercolor style. Use gentle pastel tones, smooth color transitions, and clean fills while preserving all original line art and composition. Keep the background light and airy.",
  },
  {
    id: "anime",
    label: "动漫赛璐璐",
    hint: "平涂阴影、鲜明层次，适合人物与角色立绘",
    icon: "bi-stars",
    prompt:
      "Color this line art illustration in anime cel-shading style. Use vibrant flat colors, crisp shadows, and clean highlights. Preserve all line art edges and character details with polished illustration quality.",
  },
  {
    id: "warm",
    label: "暖色插画",
    hint: "温馨故事感配色，适合生活场景与绘本",
    icon: "bi-sun",
    prompt:
      "Color this line art illustration with warm, cozy illustration palette. Use amber, coral, soft green and cream tones. Add subtle texture while keeping line art intact and readable.",
  },
  {
    id: "dreamy",
    label: "梦幻渐变",
    hint: "渐变光感、氛围感，适合星空与奇幻题材",
    icon: "bi-moon-stars",
    prompt:
      "Color this line art illustration with dreamy gradient lighting. Use lavender, cyan, pink and soft gold accents. Create atmospheric depth while preserving line art structure and clean edges.",
  },
  {
    id: "storybook",
    label: "复古绘本",
    hint: "低饱和、手绘质感，适合叙事类插画",
    icon: "bi-book",
    prompt:
      "Color this line art illustration like a vintage storybook page. Use muted earth tones, hand-painted texture, and gentle shading. Keep line art visible and maintain a classic illustrated book feel.",
  },
  {
    id: "ink-wash",
    label: "国风淡彩",
    hint: "水墨留白、低饱和点染，适合花鸟、山水与古风人物",
    icon: "bi-flower1",
    prompt:
      "Color this line art illustration with elegant Chinese ink wash and light color style. Use restrained mineral pigments, soft gradients, generous white space, and delicate brush texture while preserving all original line art.",
  },
  {
    id: "pastel-marker",
    label: "粉彩马克笔",
    hint: "柔和手账质感，适合可爱角色、日常物件和贴纸",
    icon: "bi-highlighter",
    prompt:
      "Color this line art illustration with soft pastel marker style. Use clean marker fills, gentle paper texture, subtle layered strokes, and cute harmonious colors while keeping the line art crisp and readable.",
  },
  {
    id: "flat-vector",
    label: "扁平矢量",
    hint: "清爽块面、商业插画感，适合图标与海报元素",
    icon: "bi-bezier2",
    prompt:
      "Color this line art illustration as a polished flat vector illustration. Use bold clean color blocks, minimal gradients, precise edges, and modern editorial palette while preserving the original composition.",
  },
  {
    id: "cinematic-neon",
    label: "霓虹光影",
    hint: "高对比发光边缘，适合科幻、夜景与赛博题材",
    icon: "bi-lightning-charge",
    prompt:
      "Color this line art illustration with cinematic neon lighting. Use deep shadows, glowing cyan, magenta, violet and electric accents, dramatic rim light, and keep all original line art visible.",
  },
  {
    id: "oil-paint",
    label: "厚涂油画",
    hint: "饱满笔触、层次光影，适合人物、静物和幻想插画",
    icon: "bi-brush",
    prompt:
      "Color this line art illustration with expressive oil painting style. Use rich pigments, painterly brush strokes, layered lighting and natural shadows while retaining the line art structure and subject details.",
  },
  {
    id: "portrait-skin-tone",
    label: "人物肤色",
    hint: "自然肤色、面部层次与发丝细节，适合人物线稿",
    icon: "bi-person-bounding-box",
    prompt:
      "Color this line art portrait with natural skin tones, refined facial planes, soft blush, expressive eyes, detailed hair color separation, and clean clothing colors. Preserve the original line art, anatomy, facial identity, and pose.",
  },
  {
    id: "landscape-atmosphere",
    label: "风景氛围",
    hint: "天空、远近层次、空气透视，适合山水、城市和自然场景",
    icon: "bi-mountains",
    prompt:
      "Color this landscape line art with atmospheric perspective, layered distance, natural sky gradients, grounded environmental colors, and balanced depth. Preserve the original scene composition, horizon, structures, and line details.",
  },
  {
    id: "animal-soft-fur",
    label: "动物毛色",
    hint: "毛发纹理、眼睛高光与自然花色，适合宠物和动物插画",
    icon: "bi-hearts",
    prompt:
      "Color this animal line art with believable fur, feather, scale or skin patterns as appropriate. Use soft texture, expressive eyes, subtle highlights, and natural markings while preserving the original animal shape and line art.",
  },
  {
    id: "photo-realistic",
    label: "写真质感",
    hint: "真实光泽、自然色温与镜头感，适合写真人像和产品感图片",
    icon: "bi-camera",
    prompt:
      "Color this line art with tasteful photo-realistic rendering. Use realistic materials, natural color temperature, soft camera-like lighting, controlled contrast, and subtle depth while keeping the original line art and composition readable.",
  },
  {
    id: "dramatic-lighting",
    label: "强光影",
    hint: "主光、轮廓光、阴影塑形，适合需要视觉冲击的画面",
    icon: "bi-brightness-high",
    prompt:
      "Color this line art with dramatic lighting design. Use a clear key light, rim light, cast shadows, strong value separation, and cinematic contrast. Preserve all original line art while using light and shadow to define form.",
  },
  {
    id: "soft-glamour",
    label: "轻性感",
    hint: "精致肤色、布料高光与优雅氛围，适合成人时装与轻写真",
    icon: "bi-gem",
    prompt:
      "Color this line art with elegant soft glamour styling for adult fashion illustration. Use tasteful skin rendering, refined fabric sheen, polished makeup tones, and warm studio lighting. Keep it non-explicit, stylish, and preserve the original line art.",
  },
  {
    id: "interior-space",
    label: "场景空间",
    hint: "室内外空间、材质分区与透视层次，适合建筑和环境线稿",
    icon: "bi-grid-1x2",
    prompt:
      "Color this environmental space line art with clear spatial depth, material separation, wall and floor tones, object grouping, and realistic ambient lighting. Preserve perspective, room layout, architecture, and all line art details.",
  },
  {
    id: "linear-editorial",
    label: "线性插画",
    hint: "轻色块、干净留白与杂志感，适合线条本身很重要的插画",
    icon: "bi-vector-pen",
    prompt:
      "Color this line art as a refined linear editorial illustration. Use restrained color accents, clean negative space, thin transparent fills, and minimal shading so the original line work remains the main visual structure.",
  },
  {
    id: "historical-period",
    label: "年代复古",
    hint: "旧照片、海报印刷与时代感配色，适合历史、民国、复古题材",
    icon: "bi-hourglass-split",
    prompt:
      "Color this line art with historical period atmosphere. Use aged paper warmth, muted archival colors, vintage poster texture, restrained contrast, and era-appropriate palettes while preserving all original line art and costume details.",
  },
  {
    id: "future-tech",
    label: "未来科技",
    hint: "冷光、金属、界面发光，适合机甲、科幻和智能设备",
    icon: "bi-cpu",
    prompt:
      "Color this line art with futuristic technology styling. Use cool metallic surfaces, luminous interface accents, cyan and violet light, precise material separation, and sleek sci-fi contrast while preserving the original design lines.",
  },
  {
    id: "anime-key-visual",
    label: "动漫主视觉",
    hint: "角色海报级配色、发光边缘和高完成度，适合二次元角色",
    icon: "bi-magic",
    prompt:
      "Color this line art as a polished anime key visual. Use appealing character palettes, clean cel shading, luminous highlights, expressive hair and eye colors, and poster-quality finish while preserving the original line art.",
  },
  {
    id: "game-concept",
    label: "游戏概念",
    hint: "角色、装备、怪物和场景概念图质感",
    icon: "bi-controller",
    prompt:
      "Color this line art as game concept art. Use readable silhouettes, strong material differentiation, armor and prop details, controlled fantasy lighting, and production-ready color design while preserving the original concept lines.",
  },
  {
    id: "model-render",
    label: "模型渲染",
    hint: "手办、3D 模型、材质球和棚拍效果",
    icon: "bi-box",
    prompt:
      "Color this line art with premium 3D model render styling. Use smooth materials, studio lighting, soft shadows, plastic, resin, metal or fabric surfaces as appropriate, and clean presentation while preserving the original silhouette.",
  },
  {
    id: "ecommerce-product",
    label: "电商产品",
    hint: "干净商业配色、材质高光与卖点突出，适合商品线稿",
    icon: "bi-bag-check",
    prompt:
      "Color this product line art for ecommerce presentation. Use clean commercial colors, accurate material highlights, soft studio shadows, premium product finish, and high readability on a light background while preserving all product lines.",
  },
  {
    id: "fashion-outfit",
    label: "穿搭风格",
    hint: "服装配色、面料区分和整体搭配，适合时装人物线稿",
    icon: "bi-handbag",
    prompt:
      "Color this fashion line art with stylish outfit coordination. Use cohesive clothing palettes, fabric-specific texture, accessories color balance, tasteful contrast, and runway or street-style polish while preserving the original pose and garment lines.",
  },
  {
    id: "person-soft-portrait",
    label: "柔和人物",
    hint: "柔肤、自然发色和干净服装色，适合半身人物",
    icon: "bi-person-heart",
    categoryId: "person",
    prompt:
      "Color this character line art with soft natural portrait colors. Use gentle skin shading, harmonious hair tones, clean clothing colors, subtle blush, and readable facial features while preserving the original anatomy, pose, and line art.",
  },
  {
    id: "person-fashion-character",
    label: "时装人物",
    hint: "强调服装、妆容、发丝和整体角色气质",
    icon: "bi-person-standing-dress",
    categoryId: "person",
    prompt:
      "Color this person line art as a polished fashion character illustration. Use refined makeup tones, detailed hair color separation, fabric-aware outfit colors, accessories accents, and elegant lighting while preserving the original pose and garment lines.",
  },
  {
    id: "person-hero-character",
    label: "角色立绘",
    hint: "清晰轮廓、装备配色和高完成度角色设计",
    icon: "bi-shield-shaded",
    categoryId: "person",
    prompt:
      "Color this character line art as production-ready character key art. Use strong silhouette readability, clear costume color hierarchy, material separation for props and accessories, confident shadows, and polished highlights while preserving every original design line.",
  },
  {
    id: "landscape-nature-daylight",
    label: "自然风景",
    hint: "天空、树木、水面和远近空气透视",
    icon: "bi-tree",
    categoryId: "landscape",
    prompt:
      "Color this natural landscape line art with believable daylight atmosphere. Use layered greens, sky gradients, water or mountain depth if present, soft atmospheric perspective, and grounded environmental colors while preserving the original composition and line details.",
  },
  {
    id: "landscape-city-evening",
    label: "城市黄昏",
    hint: "建筑层次、窗光、街景和暖冷对比",
    icon: "bi-buildings",
    categoryId: "landscape",
    prompt:
      "Color this city or street landscape line art with evening urban atmosphere. Use warm window lights, cool shadows, readable building planes, subtle sky glow, and clean perspective depth while preserving the original architecture and street details.",
  },
  {
    id: "landscape-fantasy-world",
    label: "幻想场景",
    hint: "奇幻天空、远景氛围和魔法色彩",
    icon: "bi-cloud-moon",
    categoryId: "landscape",
    prompt:
      "Color this fantasy landscape line art with imaginative worldbuilding colors. Use atmospheric distance, magical accent light, rich but controlled palettes, dramatic sky tones, and clear foreground-midground-background separation while preserving all scene lines.",
  },
  {
    id: "animal-pet-cozy",
    label: "宠物柔毛",
    hint: "猫狗宠物毛色、眼睛高光和温暖氛围",
    icon: "bi-house-heart",
    categoryId: "animal",
    prompt:
      "Color this pet line art with cozy natural fur colors. Use soft fur texture, believable markings, warm eye highlights, gentle nose and paw tones, and friendly lighting while preserving the original animal expression and outline.",
  },
  {
    id: "animal-wildlife-natural",
    label: "野生动物",
    hint: "自然花纹、皮毛/羽毛/鳞片和环境色",
    icon: "bi-feather",
    categoryId: "animal",
    prompt:
      "Color this wildlife line art with naturalistic animal markings. Use species-appropriate fur, feather, scale, or skin patterns, subtle environmental color influence, clear body planes, and realistic highlights while preserving the original animal structure.",
  },
  {
    id: "animal-cute-mascot",
    label: "可爱拟物",
    hint: "柔和高饱和、吉祥物和贴纸感动物",
    icon: "bi-emoji-smile",
    categoryId: "animal",
    prompt:
      "Color this animal line art as a cute mascot illustration. Use soft cheerful colors, rounded shadow shapes, bright eye accents, clean readable markings, and sticker-like polish while preserving the original line art and pose.",
  },
  {
    id: "portrait-studio-light",
    label: "棚拍写真",
    hint: "柔和主光、皮肤真实度和镜头质感",
    icon: "bi-camera-fill",
    categoryId: "portrait",
    prompt:
      "Color this line art with studio portrait photography styling. Use realistic skin tones, soft key light, gentle fill light, controlled shadows, natural hair color detail, and camera-like tonal contrast while keeping the original line art readable.",
  },
  {
    id: "portrait-film-look",
    label: "胶片写真",
    hint: "胶片颗粒、低对比和复古色温",
    icon: "bi-film",
    categoryId: "portrait",
    prompt:
      "Color this line art with tasteful film photography color grading. Use warm highlights, muted shadows, subtle grain-like texture, natural skin color, soft contrast, and nostalgic lens mood while preserving the original composition and line art.",
  },
  {
    id: "portrait-editorial",
    label: "杂志写真",
    hint: "高级配色、妆发服装和封面级光感",
    icon: "bi-journal-richtext",
    categoryId: "portrait",
    prompt:
      "Color this line art as an editorial portrait. Use elevated color styling, refined makeup and hair tones, controlled fashion lighting, premium fabric colors, and magazine-cover polish while preserving the original face, pose, and lines.",
  },
  {
    id: "lighting-backlit-glow",
    label: "逆光发光",
    hint: "轮廓光、透亮边缘和暖色背光",
    icon: "bi-sunrise",
    categoryId: "lighting",
    prompt:
      "Color this line art with strong backlit glow. Use bright rim light, luminous edges, warm background light, softer front shadows, and clear value separation while preserving the original subject and all line art.",
  },
  {
    id: "lighting-noir-shadow",
    label: "暗调阴影",
    hint: "低调高反差、硬阴影和电影黑色感",
    icon: "bi-moon",
    categoryId: "lighting",
    prompt:
      "Color this line art with moody noir lighting. Use low-key contrast, hard cast shadows, restrained saturated accents, deep but readable shadow colors, and cinematic atmosphere while preserving original line visibility.",
  },
  {
    id: "lighting-golden-hour",
    label: "黄金时刻",
    hint: "暖阳、长阴影、柔和环境光",
    icon: "bi-sunset",
    categoryId: "lighting",
    prompt:
      "Color this line art with golden hour lighting. Use warm sunlight, long soft shadows, amber highlights, cooler ambient shadows, and natural atmospheric glow while preserving the original composition and detail lines.",
  },
  {
    id: "glamour-swimwear",
    label: "泳装时装",
    hint: "成人泳装、健康肤色和海边光感，非露骨",
    icon: "bi-water",
    categoryId: "glamour",
    prompt:
      "Color this adult fashion line art with tasteful swimwear styling. Use healthy natural skin tones, sunlit fabric colors, refined highlights, beach or studio warmth if appropriate, and elegant non-explicit presentation while preserving the original line art.",
  },
  {
    id: "glamour-lingerie-fashion",
    label: "内衣时尚",
    hint: "高级布料、蕾丝质感和优雅棚拍，非露骨",
    icon: "bi-flower2",
    categoryId: "glamour",
    prompt:
      "Color this adult fashion line art with tasteful lingerie editorial styling. Use elegant fabric texture, lace or satin highlights if present, refined skin shading, soft studio light, and non-explicit fashion presentation while preserving original pose and lines.",
  },
  {
    id: "space-interior-cozy",
    label: "温馨室内",
    hint: "家具、墙面、地板和软装材质",
    icon: "bi-lamp",
    categoryId: "space",
    prompt:
      "Color this interior space line art with cozy room atmosphere. Use clear wall and floor tones, furniture material separation, warm practical lights, soft textiles, and organized spatial depth while preserving the original perspective and layout.",
  },
  {
    id: "space-architecture-clean",
    label: "建筑空间",
    hint: "建筑材质、透视和干净展示效果",
    icon: "bi-building",
    categoryId: "space",
    prompt:
      "Color this architectural line art with clean spatial rendering. Use precise material tones for concrete, glass, wood, metal or stone, controlled daylight, readable planes, and professional visualization polish while preserving all perspective lines.",
  },
  {
    id: "linear-minimal-accent",
    label: "极简点色",
    hint: "只用少量重点色，线条仍是主角",
    icon: "bi-slash-circle",
    categoryId: "linear",
    prompt:
      "Color this line art with minimal accent colors. Use very restrained fills, selective color emphasis, generous white space, thin transparent shading, and keep the original line work as the dominant visual structure.",
  },
  {
    id: "linear-editorial-poster",
    label: "编辑海报",
    hint: "杂志海报感、留白、干净块面",
    icon: "bi-newspaper",
    categoryId: "linear",
    prompt:
      "Color this line art as a refined editorial poster illustration. Use modern restrained palettes, clean flat areas, subtle texture, confident negative space, and high graphic readability while preserving original line art.",
  },
  {
    id: "historical-ancient-costume",
    label: "古风服饰",
    hint: "古装、矿物色、丝绸和水墨氛围",
    icon: "bi-flower1",
    categoryId: "historical",
    prompt:
      "Color this line art with elegant historical Chinese costume atmosphere. Use restrained mineral pigments, silk-like fabric shading, ink-wash softness, jade or gold accents if appropriate, and preserve costume details and original lines.",
  },
  {
    id: "historical-retro-poster",
    label: "复古海报",
    hint: "旧印刷、颗粒、低饱和年代色",
    icon: "bi-file-earmark-image",
    categoryId: "historical",
    prompt:
      "Color this line art with vintage poster printing style. Use muted period colors, aged paper warmth, subtle halftone or print texture, restrained contrast, and nostalgic commercial illustration polish while preserving all original line art.",
  },
  {
    id: "future-cyberpunk",
    label: "赛博霓虹",
    hint: "霓虹、雨夜、冷暖发光和高反差",
    icon: "bi-lightning-charge",
    categoryId: "future",
    prompt:
      "Color this line art with cyberpunk neon atmosphere. Use electric cyan, magenta, violet and acid accents, dark urban shadows, reflective surfaces, glowing signage or interfaces if present, and preserve the original line art.",
  },
  {
    id: "future-mecha-metal",
    label: "机甲金属",
    hint: "金属、装甲、机械分件和冷光",
    icon: "bi-robot",
    categoryId: "future",
    prompt:
      "Color this mecha or technology line art with precise metal rendering. Use cool metallic planes, panel separation, luminous sensors, subtle wear, hard surface highlights, and clear mechanical readability while preserving all design lines.",
  },
  {
    id: "future-clean-ui",
    label: "洁净科技",
    hint: "白色科技、蓝色界面和产品发布感",
    icon: "bi-window-stack",
    categoryId: "future",
    prompt:
      "Color this technology line art with clean future product styling. Use white, silver and cool blue palettes, soft interface glow, precise material separation, modern minimal contrast, and polished presentation while preserving original structure.",
  },
  {
    id: "anime-soft-shoujo",
    label: "少女漫画",
    hint: "柔粉、眼睛高光、梦幻氛围",
    icon: "bi-heart-stars",
    categoryId: "anime",
    prompt:
      "Color this line art with soft shoujo anime styling. Use delicate pastel palettes, sparkling eye highlights, gentle blush, airy hair gradients, soft flower-like accents if appropriate, and preserve original manga line art.",
  },
  {
    id: "anime-movie-bg",
    label: "动画电影",
    hint: "电影级背景色、自然光和细腻空气感",
    icon: "bi-camera-reels",
    categoryId: "anime",
    prompt:
      "Color this line art with animated feature film quality. Use natural cinematic color, detailed but clean light, atmospheric depth, harmonious character and background palettes, and polished animation art direction while preserving all lines.",
  },
  {
    id: "game-fantasy-rpg",
    label: "幻想 RPG",
    hint: "装备、魔法、职业角色和冒险感",
    icon: "bi-gem",
    categoryId: "game",
    prompt:
      "Color this line art as fantasy RPG concept art. Use clear class or role color identity, readable armor and fabric materials, controlled magical accents, strong silhouette, and production concept polish while preserving original design lines.",
  },
  {
    id: "game-monster-design",
    label: "怪物设定",
    hint: "怪物皮肤、鳞片、爪牙和危险气质",
    icon: "bi-bug",
    categoryId: "game",
    prompt:
      "Color this creature or monster line art with game concept design quality. Use believable skin, scales, horns or armor materials, threatening accent colors, strong value grouping, and readable anatomy while preserving the original creature design.",
  },
  {
    id: "game-pixel-palette",
    label: "像素配色",
    hint: "低色数、清楚块面和复古游戏感",
    icon: "bi-grid-3x3-gap",
    categoryId: "game",
    prompt:
      "Color this line art with retro game pixel-art inspired palettes. Use limited color ramps, clear flat shadow steps, crisp readable forms, and nostalgic game color harmony while preserving the original line art rather than pixelating the image.",
  },
  {
    id: "model-figure-toy",
    label: "手办玩具",
    hint: "树脂、塑料、涂装和展示灯光",
    icon: "bi-box-seam",
    categoryId: "model",
    prompt:
      "Color this line art with collectible figure toy rendering. Use smooth resin or plastic materials, clean painted surfaces, soft studio shadows, glossy highlights where appropriate, and premium display quality while preserving the silhouette and lines.",
  },
  {
    id: "model-industrial-design",
    label: "工业模型",
    hint: "产品模型、硬表面、材质分件",
    icon: "bi-nut",
    categoryId: "model",
    prompt:
      "Color this model or industrial design line art with precise product visualization. Use hard-surface material separation, controlled studio lighting, clean shadows, matte and glossy contrast, and accurate design readability while preserving all original lines.",
  },
  {
    id: "ecommerce-clean-main",
    label: "商品主图",
    hint: "白底、干净高亮、商品可读性",
    icon: "bi-bag-check",
    categoryId: "ecommerce",
    prompt:
      "Color this product line art as a clean ecommerce main image. Use accurate product colors, crisp material highlights, soft studio shadows, high readability on a light background, and commercial polish while preserving all product structure lines.",
  },
  {
    id: "ecommerce-premium-packaging",
    label: "高级包装",
    hint: "礼盒、包装材质、金属烫印和质感",
    icon: "bi-box2-heart",
    categoryId: "ecommerce",
    prompt:
      "Color this packaging or product line art with premium ecommerce styling. Use refined material colors, foil or emboss accents if present, clean label readability, soft display lighting, and high-end product finish while preserving all packaging lines.",
  },
  {
    id: "fashion-streetwear",
    label: "街头穿搭",
    hint: "运动、牛仔、潮牌和高对比配色",
    icon: "bi-scooter",
    categoryId: "fashion",
    prompt:
      "Color this outfit line art with streetwear styling. Use confident garment palettes, denim, leather, cotton or sneaker material cues, graphic accent colors, and urban fashion contrast while preserving pose and clothing construction lines.",
  },
  {
    id: "fashion-evening-dress",
    label: "礼服穿搭",
    hint: "丝绸、纱、珠光和高级配色",
    icon: "bi-stars",
    categoryId: "fashion",
    prompt:
      "Color this fashion line art with elegant evening dress styling. Use refined fabric sheen, satin or chiffon translucency if present, jewelry accent colors, graceful shadows, and formal palette harmony while preserving garment lines.",
  },
  {
    id: "fashion-seasonal",
    label: "季节穿搭",
    hint: "春夏秋冬配色和面料厚薄区分",
    icon: "bi-calendar-heart",
    categoryId: "fashion",
    prompt:
      "Color this clothing line art with seasonal outfit coordination. Use weather-appropriate fabric tones, layered garment color harmony, accessory accents, and clear textile differentiation while preserving the original clothing design and pose.",
  },
  {
    id: "real-person-natural",
    label: "真人自然",
    hint: "自然肤质、生活光线和真实人物色彩",
    icon: "bi-person-video3",
    categoryId: "real-person",
    prompt:
      "Color this human line art with natural real-person rendering. Use realistic skin undertones, believable hair color, everyday clothing colors, natural ambient light, and subtle photographic depth while preserving the original identity cues, pose, and line art.",
  },
  {
    id: "real-person-lifestyle",
    label: "生活照片",
    hint: "日常拍摄、室内外自然色和轻写实",
    icon: "bi-camera2",
    categoryId: "real-person",
    prompt:
      "Color this line art like a tasteful lifestyle photograph. Use natural scene colors, realistic skin and fabric tones, soft environmental lighting, gentle depth, and non-overprocessed color grading while preserving the original composition and lines.",
  },
  {
    id: "custom",
    label: "自定义",
    hint: "补充配色、光影与材质描述，越具体效果越稳",
    icon: "bi-pencil-square",
    prompt: "",
  },
];

function normalizeColoringStylePreset(preset) {
  const categoryId =
    preset.categoryId || LEGACY_STYLE_CATEGORY_BY_ID[preset.id] || "base";
  const category = DEFAULT_COLORING_STYLE_CATEGORIES.find(
    (item) => item.id === categoryId,
  );
  return {
    ...preset,
    categoryId,
    categoryLabel: category?.label || "基础插画",
  };
}

export const DEFAULT_COLORING_STYLE_PRESETS =
  RAW_DEFAULT_COLORING_STYLE_PRESETS.map(normalizeColoringStylePreset);

export function cloneDefaultIllustrationColoringStyleCatalog() {
  return {
    categories: DEFAULT_COLORING_STYLE_CATEGORIES.map((category, index) => ({
      ...category,
      enabled: category.enabled !== false,
      sortOrder: Number.isFinite(Number(category.sortOrder))
        ? Number(category.sortOrder)
        : (index + 1) * 10,
    })),
    styles: DEFAULT_COLORING_STYLE_PRESETS.map((style, index) => ({
      ...style,
      previewUrl: String(style.previewUrl || ""),
      enabled: style.enabled !== false,
      sortOrder: Number.isFinite(Number(style.sortOrder))
        ? Number(style.sortOrder)
        : (index + 1) * 10,
    })),
  };
}
