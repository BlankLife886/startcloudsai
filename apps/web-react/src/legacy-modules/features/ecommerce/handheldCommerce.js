const HANDHELD_MODE_PROMPT =
  '把参考商品按真实毫米尺度、不变形地放进一只解剖学正确的手里。必须保持商品刚性外形、长宽厚比例、边角、孔位、包装、Logo、文字、颜色、材质和真实尺寸；商品身份面必须锐利清晰可读，文字不得雾化、重绘或乱码。手指骨骼、左右手、握持受力、透视、接触阴影与局部遮挡必须像实拍；手迁就商品，商品不得被手挤压变形。手可以挡住商品局部，但不得挡住关键品牌面，禁止六指、关节反折和手指穿透商品，禁止 CG 感、塑料手和过白磨皮。禁止把场景或构图参考里的人物、原商品或品牌带入结果。'

const HANDHELD_THREE_REF_LOCK =
  '三图身份锁：第 1 张是商品身份，锁定几何轮廓、长宽厚比例、边角锐度、包装、Logo、文字、颜色、材质和真实尺度，禁止拉伸或融化；第 2 张是模特身份，必须是同一人，锁定脸型、五官比例、肤色、年龄感、发型和体型，禁止生成另一个相似的人；第 3 张是唯一场景事实来源，必须保留同一空间结构、关键陈设、材质、色彩、主光方向和时间氛围，只排除场景图中的人物或商品。只允许改变握持动作、机位与构图，不得改商品外形。'

const HANDHELD_PRODUCT_FIDELITY_CONSTRAINTS = [
  '商品必须保持参考图的刚性外形，长宽厚比例、轮廓、边角、孔位、接缝和印刷位置不得拉伸、挤压、弯曲、融化或圆角化；手迁就商品，商品不得迁就手。',
  '对焦平面必须落在商品身份面。商品是画面中唯一最锐利的物体，Logo、印刷和边缘必须比手指、皮肤和人脸更清晰；若景深不够，只允许虚化背景或手背，严禁虚化、雾化或重绘商品。禁止把自动对焦打在指节、指甲或人脸。',
  '严禁生成裸露、走光、色情、性暗示或暴露私密部位的画面，人物必须穿着完整、可上架的日常或商业服装；也不得生成暴力、血腥或其他不宜上架内容。',
]

const HANDHELD_SHOTS = [
  {
    id: 'hero',
    label: '手持主图',
    direction:
      '完整露出商品正面且锐利清晰，手指结构、尺度、受力与遮挡准确；商品透视匹配手部空间，接触阴影和反光跟场景主光一致，商品外形不得因握持而变形。主体占比大，适合电商主图。',
  },
  {
    id: 'present',
    label: '递出展示',
    direction:
      '把商品递给镜头或托在掌心，手指避开 Logo 和包装主文字，品牌面完整可读。',
  },
  {
    id: 'use',
    label: '使用瞬间',
    direction:
      '表现正在使用第 1 张参考图中同一件商品的瞬间，动作只服务该商品真实功能。禁止换成另一件货、场景里的杯盘摆件或更“好看”的相似品。商品外形仍完整可识别，尺度符合真人手掌。本张必须整张锐利清晰：商品、手、人物和场景陈设都要清楚，使用约 f/8 至 f/16 的深景深；禁止浅景深，禁止只让人物清晰而把商品、手或环境拍虚。',
  },
  {
    id: 'detail',
    label: '材质特写',
    direction:
      '靠近第 1 张参考图中同一件商品与手的接触面做特写。必须仍是那一件货的材质、轮廓、颜色、Logo 和包装文字，只放大已有细节，禁止重绘结构、编造新零件，也禁止换成场景中的物品或另一件道具。背景克制虚化。',
  },
  {
    id: 'ugc',
    label: '种草近景',
    direction:
      '生活化近景，适合社媒封面；必须和主图拉开差别：换成约 45° 斜侧或微俯机位，手的动作改成托在掌心、指尖捏住或正在使用，带出一点生活环境局部。对焦仍在商品，品牌面必须比手更清晰，不要做成自拍大头照，也不要用浅景深把商品拍虚。',
  },
  {
    id: 'story',
    label: '竖屏投放',
    // 投放位固定竖屏：不管套图其他张用什么比例，这张都按 9:16 出
    aspectRatio: '9:16',
    direction:
      '本张画面比例固定为 9:16 竖屏（优先于上文画面比例）。商品与手放在画面上方约三分之二内，下方约三分之一保持干净的背景作为标题安全区，不放手臂或杂物；构图要和主图明显不同，商品与手仍是第一视觉。',
  },
  {
    id: 'unbox',
    label: '开箱取出',
    direction:
      '同时交代第 1 张参考图中的包装和取出的同一件商品，两件身份都要准。禁止换成另一件货或只剩空盒、只剩裸货。',
  },
]

const HANDHELD_FULL_BODY_SHOT_DIRECTIONS = {
  hero:
    '人物从头顶到双脚完整入镜，商品正面清楚可读，右手或所选手的结构、尺度、受力与遮挡准确；商品透视和接触阴影匹配场景主光。适合作为全身手持主图。',
  present:
    '人物从头顶到双脚完整入镜，在完整站姿中把商品递向镜头或托在掌心；手指避开 Logo 和包装主文字，品牌面可读，不得裁成半身。',
  use:
    '人物从头顶到双脚完整入镜，在完整身体动作中真实使用第 1 张参考图的同一件商品；商品功能、外形和尺度准确，不得裁成局部画面。整张必须锐利清晰，商品、人物全身和场景都要清楚，禁止只让人物清晰、其余发虚。',
  detail:
    '人物从头顶到双脚完整入镜，通过姿态、光线和商品朝向表现材质与接触关系；不得只显示手部或商品局部，不得裁掉人物身体。',
  ugc:
    '生活化全身环境构图，人物从头顶到双脚完整入镜，保留真实场景和社媒种草感；商品清楚可读，不得做成自拍、胸像或半身裁切。',
  story:
    '本张画面比例固定为 9:16 竖屏（优先于上文画面比例）。竖屏全身投放构图，人物从头顶到双脚完整入镜并位于画面中上区域，底部预留标题安全区；商品与握持手保持清楚可读。',
  unbox:
    '人物从头顶到双脚完整入镜，在完整身体动作中展示包装和取出的同一件商品；两件身份准确，不得裁成桌面或手部局部画面。',
}

export const HANDHELD_DEFAULT_POSE_ID = 'grip'
export const HANDHELD_DEFAULT_STYLE_ID = 'listing'
export const HANDHELD_DEFAULT_CROP_ID = 'wrist'
export const HANDHELD_DEFAULT_PACK_ID = 'single'
export const HANDHELD_DEFAULT_HAND_ID = 'right'
export const HANDHELD_DEFAULT_CATEGORY_ID = 'other'
export const HANDHELD_DEFAULT_PLATFORM_ID = 'taobao'
export const HANDHELD_DEFAULT_LENS_ID = 'normal'
export const HANDHELD_DEFAULT_LIGHT_ID = 'fill'
export const HANDHELD_DEFAULT_CAMERA_ID = 'eye'
export const HANDHELD_DEFAULT_DEPTH_ID = 'balanced'
export const HANDHELD_DEFAULT_FOCUS_ID = 'product_identity'
export const HANDHELD_DEFAULT_MATERIAL_INTERACTION_ID = 'balanced'
export const HANDHELD_DEFAULT_PACK_STATE_ID = 'unboxed'
export const HANDHELD_DEFAULT_ARCHITECTURE_ID = 'composite'

export const HANDHELD_POSE_OPTIONS = [
  {
    id: 'grip',
    label: '自然握持',
    prompt:
      '握持姿势：自然握持。单手握住商品中段或瓶身，虎口和指腹受力清楚，商品直立或微倾，正面品牌面完整露出。',
  },
  {
    id: 'present',
    label: '单手展示',
    prompt:
      '握持姿势：单手展示。手掌托举或轻轻捏住商品上沿，像把商品递给镜头，手指避开 Logo 和包装主文字。',
  },
  {
    id: 'pinch',
    label: '三指捏',
    prompt:
      '握持姿势：三指捏。拇指与食指中指捏住商品上段或瓶颈，适合安瓶、小样和小型数码件，尺度必须像真人手。',
  },
  {
    id: 'two-finger',
    label: '两指捏',
    prompt:
      '握持姿势：两指捏。拇指与食指捏住细长商品，适合口红、唇釉，膏管色号必须完整露出。',
  },
  {
    id: 'use',
    label: '使用中',
    prompt:
      '握持姿势：使用中。表现正在使用该商品的瞬间，动作服务功能，商品仍完整可识别，尺度符合真人手掌。',
  },
  {
    id: 'open',
    label: '开盖',
    prompt:
      '握持姿势：开盖。一只手握瓶身，另一只手拧开或掀起盖子，开口和内料可识别，不要挡住品牌面。',
  },
  {
    id: 'spray',
    label: '喷',
    prompt:
      '握持姿势：喷。手指按在喷嘴上，喷嘴朝向合理，可有轻微雾气，瓶身品牌面仍可读。',
  },
  {
    id: 'pour',
    label: '倾倒',
    prompt:
      '握持姿势：倾倒。瓶口朝下或倾斜，液面符合重力，手的承重看起来真实。',
  },
  {
    id: 'apply',
    label: '涂抹',
    prompt:
      '握持姿势：涂抹。商品接触皮肤或另一只手，涂抹面清楚，色号与商品一致，不要把脸做成整张自拍。',
  },
  {
    id: 'wear',
    label: '佩戴瞬间',
    prompt:
      '握持姿势：佩戴瞬间。表现耳机入耳、打开充电盒或即将佩戴，产品外形必须可识别。',
  },
  {
    id: 'drink',
    label: '就口',
    prompt: '握持姿势：就口。杯口朝向合理，手握杯身或杯把，饮口不被手挡住。',
  },
  {
    id: 'two-hands',
    label: '双手托举',
    prompt:
      '握持姿势：双手托举。双手从下方或两侧托住商品，适合瓶罐、杯具和礼盒，手指遮挡克制，尺度真实。',
  },
  {
    id: 'unbox',
    label: '开箱取出',
    prompt:
      '握持姿势：开箱取出。同时交代包装和取出的商品，两件身份都要准，不要只剩空盒或只剩裸货。',
  },
]

export const HANDHELD_STYLE_OPTIONS = [
  {
    id: 'listing',
    label: '电商主图风',
    prompt:
      '视觉风格：电商主图。主体占比大，背景干净，商品信息完整，适合平台主图。',
  },
  {
    id: 'natural',
    label: '自然纪实',
    prompt:
      '视觉风格：自然纪实。日常光线，轻微环境细节，像随手拍到的真实使用瞬间。',
  },
  {
    id: 'premium',
    label: '高级感',
    prompt:
      '视觉风格：高级感。克制影棚或酒店质感，低饱和，干净背景，杂志广告感。',
  },
  {
    id: 'ugc',
    label: '种草风',
    prompt: '视觉风格：种草风。生活化近景，浅景深，温暖色温，适合社媒种草。',
  },
]

export const HANDHELD_CATEGORY_OPTIONS = [
  {
    id: 'perfume',
    sizeMm: [45, 30, 100],
    label: '香水/玻璃水剂',
    poseId: 'pinch',
    prompt:
      '品类：香水或玻璃水剂。玻璃折射、液面和瓶身印刷必须像实物，禁止把小瓶放大成水瓶。',
  },
  {
    id: 'skincare',
    sizeMm: [45, 45, 130],
    label: '护肤瓶',
    poseId: 'grip',
    prompt: '品类：护肤瓶。泵头、盖子和瓶身比例准确，色号与包装文字保持原样。',
  },
  {
    id: 'lipstick',
    sizeMm: [20, 20, 80],
    label: '口红唇釉',
    poseId: 'two-finger',
    prompt: '品类：口红或唇釉。两指捏持，膏管色号必须完整露出，尺度像真口红。',
  },
  {
    id: 'earbuds',
    sizeMm: [50, 25, 50],
    label: '耳机/数码件',
    poseId: 'wear',
    prompt: '品类：耳机或小型数码件。腔体轮廓准确，禁止放大到不像真耳可戴。',
  },
  {
    id: 'powerbank',
    sizeMm: [70, 15, 140],
    label: '充电宝/小家电',
    poseId: 'grip',
    prompt: '品类：充电宝或小家电。接口、按键和品牌面完整，握持要有重量感。',
  },
  {
    id: 'cup',
    sizeMm: [80, 80, 110],
    label: '杯具',
    poseId: 'drink',
    prompt: '品类：杯具。杯口朝向合理，釉面或玻璃质感真实，手握杯身或杯把。',
  },
  {
    id: 'gift',
    sizeMm: [180, 60, 240],
    label: '礼盒套装',
    poseId: 'two-hands',
    prompt: '品类：礼盒套装。盒与内件都要可识别，不要只剩一件。',
  },
  {
    id: 'other',
    label: '其他小件',
    poseId: 'grip',
    prompt: '品类：可手持的小型商品。按真实手掌尺度握持，品牌主面完整。',
  },
]

export const HANDHELD_CROP_OPTIONS = [
  {
    id: 'hand',
    label: '手指特写',
    needsPerson: false,
    icon: 'bi-hand-index',
    hint: '只要手，不要模特',
    prompt: '出镜范围：只出手和商品，裁切在手指或掌心，严禁出现人脸。',
  },
  {
    id: 'wrist',
    label: '手腕特写',
    needsPerson: false,
    icon: 'bi-hand-index-thumb',
    hint: '只要手，不要模特',
    prompt: '出镜范围：手、腕和商品，可以带到前臂，严禁出现人脸。',
  },
  {
    id: 'noface',
    label: '半身禁脸',
    needsPerson: true,
    icon: 'bi-person',
    hint: '需要模特',
    prompt: '出镜范围：可出肩和胸，但必须裁掉或转开脸，不得出现可识别五官。',
  },
  {
    id: 'bust',
    label: '半身出镜',
    needsPerson: true,
    icon: 'bi-person',
    hint: '需要模特',
    prompt: '出镜范围：半身，人物身份以模特参考为准。',
  },
  {
    id: 'full',
    label: '全身出镜',
    needsPerson: true,
    icon: 'bi-person-standing',
    hint: '需要模特',
    prompt:
      '出镜范围：严格全身，从头顶到双脚完整入镜，头、肩、腰、腿、脚和鞋都不得被画框裁掉。模特参考即使只有上半身，也只用于锁定人物身份和可见外观，不得沿用其半身裁切；必须自然补全符合该人物的下半身、站姿与服装延续。商品保持清楚可读，但不得为了放大商品裁掉人物身体。',
  },
]

export const HANDHELD_HAND_OPTIONS = [
  {
    id: 'right',
    label: '右手',
    prompt:
      '必须使用人物本人的右手握持，不是画面观察者的右侧；人物正对镜头时，右手通常出现在画面左侧。禁止镜像成左手，禁止为了构图便利换手。',
  },
  { id: 'left', label: '左手', prompt: '使用左手握持。' },
  { id: 'both', label: '双手', prompt: '使用双手配合完成动作。' },
]

export const HANDHELD_PACK_STATE_OPTIONS = [
  {
    id: 'unboxed',
    label: '出手货',
    prompt: '展示已取出的商品本体，不要只拍包装盒。',
  },
  { id: 'boxed', label: '盒装', prompt: '展示完整包装盒，盒面印刷必须准确。' },
  { id: 'kit', label: '套装', prompt: '按套装展示，清单内每件都要可识别。' },
]

export const HANDHELD_PLATFORM_OPTIONS = [
  {
    id: 'taobao',
    packId: 'single',
    styleId: 'listing',
    label: '淘宝/天猫主图',
    ratio: '1:1',
    hint: '无边框无水印，缩略图可认',
    prompt:
      '平台：淘宝/天猫主图。主体清晰，无边框、无水印、无对比图，缩略图仍能认出商品。',
  },
  {
    id: 'detail',
    packId: 'listing',
    styleId: 'listing',
    label: '详情页配图',
    ratio: '3:4',
    hint: '信息清楚，适合卖点模块',
    prompt: '平台：详情页配图。信息清楚，适合插在卖点模块里。',
  },
  {
    id: 'xhs',
    packId: 'social',
    styleId: 'ugc',
    label: '小红书',
    ratio: '3:4',
    hint: '生活近景，保留可售身份',
    prompt: '平台：小红书。生活感近景，仍要保留可售商品身份。',
  },
  {
    id: 'douyin',
    packId: 'social',
    styleId: 'ugc',
    label: '抖音/信息流',
    ratio: '9:16',
    hint: '竖构图，底部留标题区',
    prompt: '平台：抖音或信息流。竖构图，中上主体，底部留标题安全区。',
  },
  {
    // Amazon 主图只允许纯白底上的商品本身（不能有手），手持图只能放副图位
    id: 'amazon',
    packId: 'listing',
    styleId: 'listing',
    label: 'Amazon 副图',
    ratio: '1:1',
    hint: '主图须纯白无手，手持图用于副图',
    prompt:
      '平台：Amazon 副图（生活/使用场景图）。清楚展示商品在手中的真实大小和用法，商品占画面约 60% 以上；画面内不加文字、价格、促销标记、水印或边框。',
  },
  {
    id: 'shop',
    packId: 'single',
    styleId: 'premium',
    label: '独立站',
    ratio: '4:5',
    hint: '品牌干净，预留留白',
    prompt: '平台：独立站 PDP。品牌感干净，预留少量留白。',
  },
]

export const HANDHELD_LANGUAGE_OPTIONS = [
  {
    id: 'zh-CN',
    label: '简体中文',
    prompt: '简体中文',
  },
  { id: 'zh-TW', label: '繁体中文', prompt: '繁体中文' },
  { id: 'en', label: 'English', prompt: '英文' },
  { id: 'ja', label: '日本語', prompt: '日文' },
  { id: 'ko', label: '한국어', prompt: '韩文' },
  { id: 'es', label: 'Español', prompt: '西班牙文' },
  { id: 'fr', label: 'Français', prompt: '法文' },
  { id: 'de', label: 'Deutsch', prompt: '德文' },
  { id: 'pt', label: 'Português', prompt: '葡萄牙文' },
  { id: 'ar', label: 'العربية', prompt: '阿拉伯文' },
  { id: 'ru', label: 'Русский', prompt: '俄文' },
]

export function normalizeHandheldAnnotations(annotations = []) {
  return (Array.isArray(annotations) ? annotations : [])
    .slice(0, 12)
    .map((item, index) => {
      const text = String(item?.text || '').trim().slice(0, 240)
      const x = Number(item?.x)
      const y = Number(item?.y)
      if (!text || item?.enabled === false || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null
      }
      return {
        id: String(item?.id || `annotation-${index + 1}`).trim().slice(0, 80),
        role: 'product_front',
        x: Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000,
        y: Math.round(Math.min(1, Math.max(0, y)) * 10000) / 10000,
        text,
      }
    })
    .filter(Boolean)
}

export function buildHandheldAnnotationPrompt(annotations = []) {
  const selected = normalizeHandheldAnnotations(annotations)
  if (!selected.length) return ''
  return [
    '图片位置标注（坐标以商品图左上角为原点，必须逐条应用到对应位置，不得调换）：',
    ...selected.map(
      (item, index) =>
        `${index + 1}. 商品图 (${Math.round(item.x * 100)}%, ${Math.round(item.y * 100)}%)：${item.text}。`,
    ),
  ].join('\n')
}

export const HANDHELD_PACK_OPTIONS = [
  {
    id: 'single',
    label: '单张主图',
    shotIds: ['hero'],
    countLabel: '1张',
    use: '上架主图位',
    hint: '一张能挂主图的手持图',
    prompt: '本次只出一张可上架的手持主图。',
  },
  {
    id: 'listing',
    label: '详情套图',
    shotIds: ['hero', 'present', 'use', 'detail'],
    countLabel: '4张',
    use: '详情页 / A+',
    hint: '主图、递出、使用、特写同一套',
    prompt:
      '本次出一套详情用手持图，跨图必须同一只手、同一件货、同一套光。四张都是第 1 张参考图里的那一件可售商品，禁止其中一张换品、换色或改成场景里的物品。',
  },
  {
    id: 'social',
    label: '社媒投放包',
    shotIds: ['hero', 'ugc', 'story'],
    countLabel: '3张',
    use: '小红书 / 信息流',
    hint: '封面、种草近景、竖屏投放',
    prompt: '本次出社媒和信息流用手持素材，商品身份仍锁定。',
  },
  {
    id: 'unbox-set',
    label: '开箱套图',
    shotIds: ['unbox', 'hero', 'detail'],
    countLabel: '3张',
    use: '详情开箱模块',
    hint: '开箱、出手货、细节特写',
    prompt: '本次出开箱套图：先交代包装取出，再出手货主图和材质特写，包装与商品身份都要准。',
  },
  {
    id: 'ab',
    label: '主图对比',
    shotIds: ['hero', 'present'],
    countLabel: '2张',
    use: '选主图 / 测点击',
    hint: '两种构图，方便挑一张上架',
    prompt: '本次出两张主图候选：一张自然握持，一张递出展示，商品和手的身份必须一致，只改变构图。',
  },
]

export const HANDHELD_LENS_OPTIONS = [
  { id: 'auto', label: '不指定', prompt: '' },
  {
    id: 'normal',
    label: '标准 50mm',
    prompt: '镜头：约 50mm，透视接近人眼，商品和手都不变形。',
  },
  {
    id: 'portrait',
    label: '人像 85mm',
    prompt:
      '镜头：约 85mm，用中长焦把商品从背景分离；对焦点是商品身份面，不是手或人脸，禁止广角畸变。',
  },
  {
    id: 'macro',
    label: '微距',
    prompt: '镜头：微距，包装文字、材质和皮肤接触细节锐利，背景强烈虚化。',
  },
]

export const HANDHELD_LIGHT_OPTIONS = [
  {
    id: 'available',
    label: '现场光',
    prompt: '光影：若有场景参考，继承其主光方向和色温；没有场景就用柔和窗光。',
  },
  {
    id: 'fill',
    label: '补光塑形',
    prompt:
      '光影：主光来自场景或侧窗，对面加柔光，把手和商品体积打出来，接触影还在。',
  },
  {
    id: 'rim',
    label: '轮廓分离',
    prompt: '光影：侧后方加窄轮廓光，让手和商品离开背景，正面仍吃主光。',
  },
  {
    id: 'hard',
    label: '硬光刻画',
    prompt:
      '光影：硬主光，阴影边缘清楚，适合金属、玻璃高光，不要把室内改成正午户外。',
  },
]

export const HANDHELD_CAMERA_OPTIONS = [
  { id: 'eye', label: '平视', prompt: '机位：平视，像把商品递到眼前。' },
  { id: 'high', label: '微俯', prompt: '机位：微俯，看清顶面和握持关系。' },
  {
    id: 'low',
    label: '微仰',
    prompt: '机位：微仰，增加商品体量，不要夸张广角。',
  },
]

export const HANDHELD_DEPTH_OPTIONS = [
  {
    id: 'balanced',
    label: '手与商品清晰',
    prompt:
      '景深与距离：中近景，对焦商品身份面；商品必须比手更锐利，手可以清楚但不能抢过商品，背景柔和分离。',
  },
  {
    id: 'deep',
    label: '全主体锐利',
    prompt:
      '景深与距离：使用约 f/11 至 f/16 的深景深效果，商品从正面到边缘、手指到手腕都清晰。',
  },
  {
    id: 'shallow',
    label: '浅景深',
    prompt:
      '景深与距离：浅景深也必须对焦商品身份面和 Logo；虚化只能落在背景，必要时手背可略虚，商品本身不得虚化。',
  },
  {
    id: 'contextual',
    label: '环境中景',
    prompt:
      '景深与距离：稍远的环境中景，交代真实使用空间，同时确保商品仍是画面中最醒目的主体。',
  },
]

export const HANDHELD_FOCUS_OPTIONS = [
  {
    id: 'product_identity',
    label: '商品身份',
    prompt:
      '视觉焦点：第一视觉中心与对焦都锁定商品品牌面、轮廓和配色；手指只是支撑，不得成为最清晰的区域。',
  },
  {
    id: 'hand_contact',
    label: '握持接触',
    prompt:
      '视觉焦点：商品与指腹接触区域优先可读，清楚表现受力、遮挡和接触阴影。',
  },
  {
    id: 'functional_detail',
    label: '功能细节',
    prompt:
      '视觉焦点：对准商品的开口、按钮、盖子、镜头模组或使用部件，功能结构不得被手遮住。',
  },
  {
    id: 'lifestyle_action',
    label: '使用动作',
    prompt:
      '视觉焦点：先读懂正在发生的真实使用动作，再读到商品身份；人物和环境不得抢主体。',
  },
]

export const HANDHELD_MATERIAL_INTERACTION_OPTIONS = [
  {
    id: 'balanced',
    label: '自动匹配',
    prompt:
      '材质交互：根据商品参考自动匹配表面反光、手指压力、接触阴影和边缘遮挡，不改变原材质。',
  },
  {
    id: 'glass',
    label: '玻璃 / 液体',
    prompt:
      '材质交互：保留玻璃透明度、折射、受控高光和液面边缘，手指透射与遮挡关系真实。',
  },
  {
    id: 'metal',
    label: '金属',
    prompt:
      '材质交互：金属边缘产生连续线性高光，反射方向跟随主光，禁止融化、拉伸或塑料化。',
  },
  {
    id: 'matte',
    label: '哑光',
    prompt:
      '材质交互：保留细微颗粒与柔和明暗过渡，指腹接触处仅有轻微压痕，禁止油亮。',
  },
  {
    id: 'plastic',
    label: '塑料 / 树脂',
    prompt:
      '材质交互：使用克制表面光泽和准确硬边，避免蜡感、廉价过曝与软化变形。',
  },
  {
    id: 'paper',
    label: '纸盒 / 包装',
    prompt: '材质交互：印刷、折边、压纹和盒角清楚，手指握持不压坏包装结构。',
  },
  {
    id: 'soft_goods',
    label: '织物 / 软材',
    prompt:
      '材质交互：表现织纹、自然褶皱和受力压缩，商品轮廓与品牌标识仍准确。',
  },
  {
    id: 'screen',
    label: '屏幕 / 镜面',
    prompt:
      '材质交互：锁定屏幕或镜面平面，控制反射与指纹，禁止界面、镜头孔位和边框变形。',
  },
]

export const HANDHELD_PHOTO_PRESET_OPTIONS = [
  {
    id: 'listing',
    label: '商品主图',
    icon: 'bi-bag-check',
    description: '商品清楚，直接上架',
    settings: {
      style: 'listing',
      lens: 'normal',
      depth: 'deep',
      focus: 'product_identity',
      light: 'fill',
      camera: 'eye',
      materialInteraction: 'balanced',
      architecture: 'composite',
    },
  },
  {
    id: 'lifestyle',
    label: '生活种草',
    icon: 'bi-cup-hot',
    description: '自然场景，有使用感',
    settings: {
      style: 'ugc',
      lens: 'normal',
      depth: 'contextual',
      focus: 'lifestyle_action',
      light: 'available',
      camera: 'eye',
      materialInteraction: 'balanced',
      architecture: 'diffusion',
    },
  },
  {
    id: 'function',
    label: '功能展示',
    icon: 'bi-hand-index-thumb',
    description: '突出按钮、开口或用法',
    settings: {
      style: 'natural',
      lens: 'normal',
      depth: 'deep',
      focus: 'functional_detail',
      light: 'fill',
      camera: 'high',
      materialInteraction: 'balanced',
      architecture: 'diffusion',
    },
  },
  {
    id: 'material',
    label: '材质特写',
    icon: 'bi-gem',
    description: '突出工艺、纹理与反光',
    settings: {
      style: 'premium',
      lens: 'macro',
      depth: 'shallow',
      focus: 'hand_contact',
      light: 'hard',
      camera: 'high',
      materialInteraction: 'balanced',
      architecture: 'composite',
    },
  },
]

export function handheldPhotoPresetById(id) {
  return handheldOptionById(HANDHELD_PHOTO_PRESET_OPTIONS, id, 'listing')
}

export const HANDHELD_ARCHITECTURE_OPTIONS = [
  {
    id: 'auto',
    label: '自动',
    prompt:
      '按品类选择最稳的合成方式：优先保住商品像素、印刷与刚性轮廓，手和场景按真实摄影生成，禁止重绘或软化商品外形。',
  },
  {
    id: 'diffusion',
    label: '身份锁定生成',
    prompt: '生成方式：多参考身份锁定，一次生成完整实拍，不许另造商品。',
  },
  {
    id: 'insert',
    label: '空握再放货',
    prompt:
      '生成方式：先形成符合握法的手型，再把参考商品按正确尺度放进手里，接缝和接触影必须自然。',
  },
  {
    id: 'composite',
    label: '商品像素保真',
    prompt:
      '生成方式：商品区域尽量保留参考像素与印刷，只生成手、接触影和环境，禁止重绘 Logo 和包装文字。',
  },
  {
    id: 'swap',
    label: '真图换货',
    prompt:
      '生成方式：若有构图参考，保留那张图里的手、姿势和光线，只把原商品替换成当前商品。',
  },
]

function handheldOptionById(list, id, fallbackId) {
  return (
    list.find((item) => item.id === id) ||
    list.find((item) => item.id === fallbackId) ||
    list[0]
  )
}

function handheldSelectedOptionById(list, id) {
  const value = String(id || '').trim()
  return value ? list.find((item) => item.id === value) || null : null
}

export function handheldPoseById(id) {
  return handheldOptionById(HANDHELD_POSE_OPTIONS, id, HANDHELD_DEFAULT_POSE_ID)
}

export function handheldStyleById(id) {
  return handheldOptionById(
    HANDHELD_STYLE_OPTIONS,
    id,
    HANDHELD_DEFAULT_STYLE_ID,
  )
}

export function handheldCategoryById(id) {
  return handheldOptionById(
    HANDHELD_CATEGORY_OPTIONS,
    id,
    HANDHELD_DEFAULT_CATEGORY_ID,
  )
}

export function handheldCropById(id) {
  return handheldOptionById(HANDHELD_CROP_OPTIONS, id, HANDHELD_DEFAULT_CROP_ID)
}

export function handheldHandById(id) {
  return handheldOptionById(HANDHELD_HAND_OPTIONS, id, HANDHELD_DEFAULT_HAND_ID)
}

export function handheldPackById(id) {
  return handheldOptionById(HANDHELD_PACK_OPTIONS, id, HANDHELD_DEFAULT_PACK_ID)
}

export function handheldPlatformById(id) {
  return handheldOptionById(
    HANDHELD_PLATFORM_OPTIONS,
    id,
    HANDHELD_DEFAULT_PLATFORM_ID,
  )
}

export function handheldLensById(id) {
  return handheldOptionById(HANDHELD_LENS_OPTIONS, id, HANDHELD_DEFAULT_LENS_ID)
}

export function handheldLightById(id) {
  return handheldOptionById(
    HANDHELD_LIGHT_OPTIONS,
    id,
    HANDHELD_DEFAULT_LIGHT_ID,
  )
}

export function handheldCameraById(id) {
  return handheldOptionById(
    HANDHELD_CAMERA_OPTIONS,
    id,
    HANDHELD_DEFAULT_CAMERA_ID,
  )
}

export function handheldDepthById(id) {
  return handheldOptionById(
    HANDHELD_DEPTH_OPTIONS,
    id,
    HANDHELD_DEFAULT_DEPTH_ID,
  )
}

export function handheldFocusById(id) {
  return handheldOptionById(
    HANDHELD_FOCUS_OPTIONS,
    id,
    HANDHELD_DEFAULT_FOCUS_ID,
  )
}

export function handheldMaterialInteractionById(id) {
  return handheldOptionById(
    HANDHELD_MATERIAL_INTERACTION_OPTIONS,
    id,
    HANDHELD_DEFAULT_MATERIAL_INTERACTION_ID,
  )
}

export function handheldPackStateById(id) {
  return handheldOptionById(
    HANDHELD_PACK_STATE_OPTIONS,
    id,
    HANDHELD_DEFAULT_PACK_STATE_ID,
  )
}

export function handheldEffectiveArchitecture(architecture, hasLayout = false) {
  void hasLayout
  return String(architecture || '').trim()
}

export function handheldArchitectureById(id) {
  return handheldOptionById(
    HANDHELD_ARCHITECTURE_OPTIONS,
    id,
    HANDHELD_DEFAULT_ARCHITECTURE_ID,
  )
}

export function handheldCropNeedsPerson(crop) {
  return Boolean(handheldCropById(crop).needsPerson)
}

// 没手动选握法时按品类给默认握法（口红两指捏、杯具就口……）
export function handheldEffectivePoseId(pose, category) {
  const value = String(pose || '').trim()
  if (value) return value
  return handheldSelectedOptionById(HANDHELD_CATEGORY_OPTIONS, category)?.poseId || ''
}

// 没手动选风格时跟随投放渠道（小红书→种草风、独立站→高级感……）
export function handheldEffectiveStyleId(style, platform) {
  const value = String(style || '').trim()
  if (value) return value
  return handheldSelectedOptionById(HANDHELD_PLATFORM_OPTIONS, platform)?.styleId || ''
}

export function handheldDefaultSizeMm(category) {
  const size = handheldSelectedOptionById(HANDHELD_CATEGORY_OPTIONS, category)?.sizeMm
  return Array.isArray(size) ? { length: size[0], width: size[1], height: size[2] } : null
}

// 长宽高都填了且在 1–2000mm 之间才算有效，缺一项就不写进提示词
export function normalizeHandheldSizeMm(size) {
  if (!size || typeof size !== 'object') return null
  const values = ['length', 'width', 'height'].map((key) => Number.parseFloat(size[key]))
  if (!values.every((value) => Number.isFinite(value) && value >= 1 && value <= 2000)) return null
  const [length, width, height] = values.map((value) => Math.round(value * 10) / 10)
  return { length, width, height }
}

export function buildHandheldSizePrompt(size) {
  const value = normalizeHandheldSizeMm(size)
  if (!value) return ''
  const dims = `${value.length}×${value.width}×${value.height} mm（长×宽×高）`
  // 按品类预填的只是常见尺寸，和这件货的真实比例可能不一样：只拿来定大小，不拿来改形状
  if (size?.auto) {
    return `实物尺寸（按品类估计）：约 ${dims}，只用来判断商品在成人手中的大小（手掌宽约 80 mm）；商品外形和长宽比例一律以商品图为准，不得为了贴合这个尺寸拉伸或压扁。`
  }
  return `实物尺寸：约 ${dims}。按成年人手掌宽约 80 mm、食指长约 75 mm 的比例呈现商品大小，禁止放大或缩小。`
}

// 没给场景图时按风格用固定背景：卡片上告诉用户的就是这里写进提示词的
const HANDHELD_SET_BACKDROPS = {
  listing: { label: '浅灰白棚拍背景', prompt: '浅灰白无缝影棚背景，柔和均匀的正面光' },
  natural: { label: '居家木桌与窗光', prompt: '明亮的居家木质桌面，侧窗自然光' },
  premium: { label: '深色哑光台面', prompt: '低饱和深色哑光台面，克制的影棚侧光' },
  ugc: { label: '温暖居家环境', prompt: '温暖明亮的居家环境，背景轻度虚化' },
}

function handheldBackdrop(style) {
  return HANDHELD_SET_BACKDROPS[style] || HANDHELD_SET_BACKDROPS.listing
}

export function handheldAutoBackdropLabel(style, platform) {
  return handheldBackdrop(handheldEffectiveStyleId(style, platform)).label
}

export function buildHandheldSetConsistencyPrompt({
  multiShot = false,
  style = '',
  hasScene = false,
  hasModel = false,
  hasHand = false,
} = {}) {
  const parts = []
  if (!hasScene) {
    const backdrop = handheldBackdrop(style).prompt
    parts.push(
      multiShot
        ? `整套统一背景：每张都用${backdrop}，不得一张棚拍、一张户外或换成别的环境。`
        : `背景：${backdrop}。`,
    )
  }
  if (multiShot && !hasModel && !hasHand) {
    parts.push('整套使用同一只手：肤色、指甲、袖口和饰品每张一致（戴表就每张都戴，不戴就都不戴），不得换人。')
  }
  return parts.join('')
}

export function buildHandheldPosePrompt(pose) {
  const id = pose && typeof pose === 'object' ? pose.id : pose
  return handheldSelectedOptionById(HANDHELD_POSE_OPTIONS, id)?.prompt || ''
}

export function buildHandheldStylePrompt(style) {
  const id = style && typeof style === 'object' ? style.id : style
  return handheldSelectedOptionById(HANDHELD_STYLE_OPTIONS, id)?.prompt || ''
}

export function handheldReferenceLabels({
  hasModel = false,
  hasHand = false,
  hasScene = false,
  hasLayout = false,
  variantCount = 0,
  angleRoles = [],
} = {}) {
  const roles = ['商品身份']
  for (const slot of HANDHELD_PRODUCT_ANGLE_SLOTS) {
    if (angleRoles.includes(slot.role)) roles.push(slot.refLabel)
  }
  for (
    let index = 0;
    index < Math.max(0, Number(variantCount) || 0);
    index += 1
  ) {
    roles.push(`色号变体 ${index + 1}`)
  }
  if (hasModel) roles.push('模特身份')
  else if (hasHand) roles.push('手部身份')
  if (hasScene) roles.push('场景环境')
  if (hasLayout) roles.push('构图参考')
  return roles
}

export function buildHandheldIdentityLock({
  hasModel = false,
  hasHand = false,
  hasScene = false,
  hasLayout = false,
  variantCount = 0,
  angleCount = 0,
} = {}) {
  if (hasModel && hasScene && !hasLayout && !variantCount && !angleCount)
    return HANDHELD_THREE_REF_LOCK
  const parts = [
    '商品身份锁：第 1 张是唯一可售商品事实来源，锁定几何轮廓、长宽厚比例、边角锐度、包装、Logo、文字、颜色、材质和真实尺度，禁止变形。',
  ]
  if (angleCount > 0) {
    parts.push(
      `第 2${angleCount > 1 ? `–${angleCount + 1}` : ''} 张是同一件商品的其他角度，只用来还原对应的面，身份仍以第 1 张为准。`,
    )
  }
  if (variantCount > 0) {
    parts.push(
      '后续色号变体图只提供颜色或包装差异，外形结构仍以第 1 张为准；本张只使用提示词指定的那一个色号。',
    )
  }
  if (hasModel) {
    parts.push(
      '若包含模特参考，必须是同一人，锁定脸型、五官、肤色、年龄感、发型和体型，禁止换成路人。',
    )
  } else if (hasHand) {
    parts.push(
      '手部参考只定义同一只手的肤色、骨骼比例、指甲和可见饰物，不得扩展生成可识别人脸。',
    )
  } else {
    parts.push('没有模特参考时，只生成手和前臂，严禁编造可识别人脸。')
  }
  if (hasScene) {
    parts.push(
      '场景参考是唯一背景事实来源，锁定同一空间结构、关键陈设、材质、色彩、主光方向和时间氛围；只排除场景图中的人物或商品，不得把整个场景替换成通用影棚、房间、街景或纯色背景。',
    )
  }
  if (hasLayout) {
    parts.push(
      '构图参考只定义构图、主体占比、光线和手的姿势，必须彻底换成当前商品，不得复制参考中的原商品、品牌、Logo 或人物身份。',
    )
  }
  parts.push('只允许改变握持动作、机位与构图，不得另造或改形商品。')
  return parts.join('')
}

export const HANDHELD_USE_SHOT_SHARPNESS_OVERRIDE =
  '本张使用瞬间覆盖（优先于上文景深与虚化要求）：整张画面必须锐利清晰，商品、手、人物和场景陈设都要清楚；使用约 f/8 至 f/16 的深景深。禁止浅景深，禁止背景柔和分离，禁止只让人物清晰而把商品、手或环境拍虚。'

export function isHandheldUseShotId(id) {
  const value = String(id || '')
  return value === 'use' || value.startsWith('use-')
}

export function buildHandheldOutputConstraints({
  crop,
  hand,
  hasModel = false,
  hasScene = false,
} = {}) {
  const constraints = [...HANDHELD_PRODUCT_FIDELITY_CONSTRAINTS]
  if (crop === 'full') {
    constraints.push(
      hasModel
        ? '每张都必须从头顶到双脚完整显示同一位参考模特，双脚和鞋完整可见，严禁半身、胸像、近景裁切。模特参考若只有上半身，只锁定人物身份与可见外观，必须自然补全符合该人物的下半身、站姿和服装延续，绝不能继承参考图的半身画幅。'
        : '每张都必须从头顶到双脚完整显示人物，双脚和鞋完整可见，严禁半身、胸像或近景裁切。',
    )
  }
  if (hand === 'right') {
    constraints.push(
      '每张都必须由人物本人的右手握持商品；人物正对镜头时，该手通常位于画面左侧。严禁镜像、左右手互换或改用左手。',
    )
  } else if (hand === 'left') {
    constraints.push(
      '每张都必须由人物本人的左手握持商品；人物正对镜头时，该手通常位于画面右侧。严禁镜像、左右手互换或改用右手。',
    )
  } else if (hand === 'both') {
    constraints.push('每张都必须使用人物本人的双手配合完成握持动作，不得改成单手。')
  }
  if (hasScene) {
    constraints.push(
      '每张都必须直接以场景参考为唯一背景事实，保留同一空间结构、关键陈设、材质、色彩、主光方向和时间氛围；允许改变机位和景深，但严禁换成另一个房间、影棚、街景、纯色背景或泛化相似场景。',
    )
  }
  return constraints.length
    ? `最终执行硬约束（优先级最高）：${constraints.join('')}`
    : ''
}

export function handheldShotBlueprints(packId, { crop } = {}) {
  const pack = handheldPackById(packId)
  const used = {}
  return pack.shotIds
    .map((shotId) => {
      const shot = HANDHELD_SHOTS.find((item) => item.id === shotId)
      if (!shot) return null
      used[shotId] = (used[shotId] || 0) + 1
      const normalized =
        crop === 'full' && HANDHELD_FULL_BODY_SHOT_DIRECTIONS[shotId]
          ? {
              ...shot,
              label: shot.label.replace('近景', '全身').replace('特写', '全身'),
              direction: HANDHELD_FULL_BODY_SHOT_DIRECTIONS[shotId],
            }
          : shot
      return used[shotId] > 1
        ? { ...normalized, id: `${shotId}-${used[shotId]}` }
        : normalized
    })
    .filter(Boolean)
}

export function buildHandheldTaskPrompt({
  productName = '',
  sellingPoints = '',
  sku = '',
  category,
  packState,
  pose,
  style,
  crop,
  hand,
  platform,
  lens,
  light,
  camera,
  depth,
  focus,
  materialInteraction,
  architecture,
  pack,
  hasModel = false,
  hasHand = false,
  hasScene = false,
  hasLayout = false,
  aspectRatio = '4:5',
  language = '',
  annotations = [],
  angleRoles = [],
  sizeMm = null,
} = {}) {
  pose = handheldEffectivePoseId(pose, category)
  style = handheldEffectiveStyleId(style, platform)
  const categoryOption = handheldSelectedOptionById(
    HANDHELD_CATEGORY_OPTIONS,
    category,
  )
  const cropOption = handheldCropById(crop)
  const handOption = handheldSelectedOptionById(HANDHELD_HAND_OPTIONS, hand)
  const platformOption = handheldPlatformById(platform)
  const lensOption = handheldSelectedOptionById(HANDHELD_LENS_OPTIONS, lens)
  const lightOption = handheldSelectedOptionById(HANDHELD_LIGHT_OPTIONS, light)
  const cameraOption = handheldSelectedOptionById(
    HANDHELD_CAMERA_OPTIONS,
    camera,
  )
  const depthOption = handheldSelectedOptionById(HANDHELD_DEPTH_OPTIONS, depth)
  const focusOption = handheldSelectedOptionById(HANDHELD_FOCUS_OPTIONS, focus)
  const materialInteractionOption = handheldSelectedOptionById(
    HANDHELD_MATERIAL_INTERACTION_OPTIONS,
    materialInteraction,
  )
  const architectureOption = handheldSelectedOptionById(
    HANDHELD_ARCHITECTURE_OPTIONS,
    handheldEffectiveArchitecture(architecture, hasLayout),
  )
  const packOption = handheldPackById(pack)
  const packStateOption = handheldSelectedOptionById(
    HANDHELD_PACK_STATE_OPTIONS,
    packState,
  )
  const languageOption = handheldSelectedOptionById(
    HANDHELD_LANGUAGE_OPTIONS,
    language,
  )
  const summary = handheldSelectionSummary({
    pose, hand, crop, lens, light, camera, depth, style, category, packState, platform,
  })
  const conflicts = handheldSelectionConflicts({ lens, depth, crop, pack, hasScene, angleRoles })
  const multiShot = packOption.shotIds.length > 1
  return [
    `任务：手持商品图。${HANDHELD_MODE_PROMPT}`,
    summary.length
      ? `用户已选（每项都必须在画面中体现，优先级高于下方通用描述）：${summary.map(([key, value]) => `${key}=${value}`).join('；')}。`
      : '',
    handheldAngleCoveragePrompt(angleRoles, pack),
    productName.trim()
      ? `商品名称：${productName.trim()}。`
      : '商品名称：根据商品图片准确识别。',
    sku.trim() ? `货号：${sku.trim()}。` : '',
    sellingPoints.trim() ? `卖点与上架要求：${sellingPoints.trim()}。` : '',
    languageOption
      ? `画面文案语言：${languageOption.prompt}。若画面出现新增文案或标注要求重绘文字，只能使用该语言，不得混用其他语言。`
      : '',
    buildHandheldAnnotationPrompt(annotations),
    categoryOption?.prompt,
    buildHandheldSizePrompt(sizeMm),
    packStateOption?.prompt,
    buildHandheldPosePrompt(pose),
    handOption?.prompt,
    cropOption.prompt,
    hasModel
      ? '人物身份只以模特参考图为准，不要按人群标签另造人物。'
      : hasHand
        ? '手部身份以手部参考图为准，只生成手和前臂，不要生成可识别人脸。'
        : '不要生成可识别人脸。',
    hasScene
      ? '场景参考是唯一背景事实来源；每张都要保留同一空间结构、关键陈设、材质、色彩、主光方向和时间氛围，只排除场景图中的人物或商品，不得替换成泛化相似场景。'
      : '',
    packOption.prompt,
    architectureOption?.prompt,
    lensOption?.prompt,
    depthOption?.prompt,
    focusOption?.prompt,
    lightOption?.prompt,
    cameraOption?.prompt,
    materialInteractionOption?.prompt,
    buildHandheldStylePrompt(style),
    buildHandheldSetConsistencyPrompt({ multiShot, style, hasScene, hasModel, hasHand }),
    ...conflicts.map((item) => item.prompt),
    multiShot
      ? `${platformOption.prompt.replace(/。$/, '')}（主图位严格遵守；套图其他张保持同一风格，按各自职责构图）。`
      : platformOption.prompt,
    `画面比例：${aspectRatio}。`,
  ]
    .filter(Boolean)
    .join('\n')
}

// ---- 货不对版治理 -------------------------------------------------------
// 1. 多角度商品图：只给正面时，AI 只能猜侧面/背面，最容易走样。
export const HANDHELD_PRODUCT_ANGLE_SLOTS = [
  { role: 'productSide', label: '侧面', refRole: 'product_side', refLabel: '商品侧面' },
  { role: 'productBack', label: '背面', refRole: 'product_back', refLabel: '商品背面' },
  { role: 'productLogo', label: 'Logo', refRole: 'logo_detail', refLabel: 'Logo 特写' },
]

// 需要转动商品、会露出正面以外区域的机位
const HANDHELD_TURNING_SHOTS = new Set(['present', 'use', 'detail', 'unbox', 'ugc'])

export function handheldAngleCoveragePrompt(angleRoles = [], pack) {
  const have = new Set(angleRoles)
  const labels = HANDHELD_PRODUCT_ANGLE_SLOTS.filter((slot) => have.has(slot.role))
  if (!labels.length) {
    const turning = handheldPackById(pack).shotIds.some((id) => HANDHELD_TURNING_SHOTS.has(id))
    return turning
      ? '商品只提供了正面图：每张商品转角不超过 30°，只露出参考图里看得见的面；看不见的侧面、背面、底部保持简洁、与正面同色同材质，禁止臆造新的按钮、接口、文字、标签或图案。'
      : '商品只提供了正面图：保持正面朝向镜头，禁止臆造看不见的侧面、背面或底部细节。'
  }
  const parts = labels.map((slot) => slot.refLabel).join('、')
  return `商品另外提供了${parts}参考：这些是同一件商品的其他角度，露出对应的面时必须照参考还原，不是另一件商品或色号；参考里没有的面仍不得臆造细节。`
}

// 2. 用户选择摘要：放在提示词最前，避免被长规则淹没。
export function handheldSelectionSummary({
  pose, hand, crop, lens, light, camera, depth, style, category, packState, platform,
} = {}) {
  const pick = (list, id) => handheldSelectedOptionById(list, id)?.label || ''
  pose = handheldEffectivePoseId(pose, category)
  style = handheldEffectiveStyleId(style, platform)
  const rows = [
    ['品类', pick(HANDHELD_CATEGORY_OPTIONS, category)],
    ['握持', pick(HANDHELD_POSE_OPTIONS, pose)],
    ['手', pick(HANDHELD_HAND_OPTIONS, hand)],
    ['出镜', handheldCropById(crop)?.label || ''],
    ['包装', pick(HANDHELD_PACK_STATE_OPTIONS, packState)],
    ['镜头', pick(HANDHELD_LENS_OPTIONS, lens)],
    ['景深', pick(HANDHELD_DEPTH_OPTIONS, depth)],
    ['光影', pick(HANDHELD_LIGHT_OPTIONS, light)],
    ['机位', pick(HANDHELD_CAMERA_OPTIONS, camera)],
    ['风格', pick(HANDHELD_STYLE_OPTIONS, style)],
    ['渠道', handheldPlatformById(platform)?.label || ''],
  ].filter(([, value]) => value && value !== '不指定')
  return rows
}

// 3. 选项冲突：界面提示 + 提示词里写明谁让步，避免模型自己挑一个。
// 套图缺场景或手的参考时，先出第 1 张，其余几张拿它当整套参考（统一背景、光线和手）
export function handheldUseAnchorHero({ shotCount = 1, hasScene = false, hasPerson = false } = {}) {
  return shotCount > 1 && !(hasScene && hasPerson)
}

export function handheldSelectionConflicts({
  lens, depth, crop, pack, hasScene = false, hasPerson = false, angleRoles = [],
} = {}) {
  const shotIds = handheldPackById(pack).shotIds
  const conflicts = []
  if (lens === 'macro' && crop === 'full') {
    conflicts.push({
      id: 'macro-full',
      message: '全身出镜不适合微距，本次按标准镜头拍',
      prompt: '冲突处理：出镜范围是全身，微距不成立，按约 50mm 标准镜头拍摄，忽略微距要求。',
    })
  } else if (lens === 'macro' && hasScene) {
    conflicts.push({
      id: 'macro-scene',
      message: '微距会把场景虚化到认不出，已改为适度虚化',
      prompt: '冲突处理：已选场景参考，微距只用于拉近主体，背景虚化控制在仍能认出场景陈设和色调的程度，不要虚化成纯色。',
    })
  }
  if (depth === 'shallow' && hasScene && lens !== 'macro') {
    conflicts.push({
      id: 'shallow-scene',
      message: '浅景深会弱化场景，场景仍保持可辨认',
      prompt: '冲突处理：浅景深与场景参考同时存在时，背景只做轻度虚化，场景的空间结构和主要陈设仍须可辨认。',
    })
  }
  if ((depth === 'shallow' || lens === 'macro') && shotIds.includes('use')) {
    conflicts.push({
      id: 'use-sharp',
      message: '「使用瞬间」那张要求整张清晰，浅景深/微距对它不生效',
      prompt: '',
    })
  }
  if (handheldUseAnchorHero({ shotCount: shotIds.length, hasScene, hasPerson })) {
    conflicts.push({
      id: 'anchor-hero',
      level: 'info',
      message: '先出第 1 张，其余几张照它统一背景和手，整套多等约半分钟',
      prompt: '',
    })
  }
  if (!angleRoles.length && shotIds.some((id) => HANDHELD_TURNING_SHOTS.has(id))) {
    conflicts.push({
      id: 'front-only',
      level: 'info',
      message: '只有正面图，套图里转角度的几张可能被猜错，建议补侧面/背面',
      prompt: '',
    })
  }
  return conflicts
}
