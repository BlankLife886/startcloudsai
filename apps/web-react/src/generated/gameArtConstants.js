// Generated from apps/web/src/views/GameArtStudioView.vue.
export const STUDIO_BACKGROUND_OPTIONS = [
  { id: 'wireframe-stage', label: '线框地形', procedural: true },
  { id: 'wireframe-horizon', label: '黑白地平线', src: '/game-art/wireframe-horizon.jpg' },
]

export const CHARACTER_POSE_OPTIONS = [
  { id: 'auto', label: '自动匹配', prompt: '' },
  {
    id: 'model-front',
    label: '模特正面',
    prompt: '时装模特正面站姿，肩胯自然错位，重心稳定，完整展示服装',
  },
  {
    id: 'contrapposto',
    label: '古典对立式',
    prompt: '经典 contrapposto 对立式站姿，重心落在单腿，肩胯反向平衡',
  },
  {
    id: 'hand-on-hip',
    label: '单手叉腰',
    prompt: '单手自然叉腰，另一只手放松，肘部与腰线轮廓清楚',
  },
  {
    id: 'hands-on-hips',
    label: '双手叉腰',
    prompt: '双手叉腰的自信模特站姿，双肘完整可见，肩颈放松',
  },
  {
    id: 'one-pocket',
    label: '单手插袋',
    prompt: '一只手自然插入口袋，另一只手放松，手腕和口袋接触准确',
  },
  {
    id: 'both-pockets',
    label: '双手插袋',
    prompt: '双手自然插袋，肩部放松，服装褶皱与口袋受力关系真实',
  },
  {
    id: 'arms-crossed',
    label: '双臂抱胸',
    prompt: '双臂自然交叠于身前，手指与前臂结构清楚，不遮挡面部',
  },
  {
    id: 'hands-behind',
    label: '双手背后',
    prompt: '双手置于身后，肩线自然打开，身体轮廓与服装正面完整可读',
  },
  {
    id: 'adjust-collar',
    label: '整理衣领',
    prompt: '一只手整理衣领或领带，手指接触准确，姿态自然从容',
  },
  {
    id: 'hold-lapel',
    label: '轻扶翻领',
    prompt: '单手轻扶外套翻领，另一手自然下垂，突出上装剪裁和材质',
  },
  {
    id: 'touch-hair',
    label: '整理头发',
    prompt: '单手自然整理头发，手掌不遮脸，发丝与手指接触清晰',
  },
  {
    id: 'over-shoulder',
    label: '回眸',
    prompt: '身体略背向镜头并自然回眸，头颈扭转幅度真实，背部服装清楚',
  },
  {
    id: 'side-model',
    label: '模特侧身',
    prompt: '时装模特侧身站姿，头部轻转向镜头，侧面轮廓与服装层次清楚',
  },
  {
    id: 'rear-model',
    label: '背身展示',
    prompt: '背身模特展示姿势，头部轻微侧转，完整展示背部剪裁与配件',
  },
  {
    id: 'crossed-ankles',
    label: '脚踝交叉',
    prompt: '站立时脚踝自然交叉，重心可信，腿部和鞋靴完整无遮挡',
  },
  {
    id: 'wide-stance',
    label: '宽距站姿',
    prompt: '双脚略宽于肩的稳定站姿，膝盖方向与重心关系准确',
  },
  {
    id: 'runway-walk',
    label: '台步行走',
    prompt: '时装台步中的自然行走瞬间，前后脚完整，衣摆动态轻盈',
  },
  {
    id: 'casual-walk',
    label: '自然行走',
    prompt: '日常自然行走关键帧，手臂摆动与步幅协调，重心落点准确',
  },
  {
    id: 'lean-wall',
    label: '倚墙站立',
    prompt: '肩背轻靠墙面的放松站姿，身体接触和衣料受压关系真实',
  },
  {
    id: 'lean-forward',
    label: '微微前倾',
    prompt: '上身轻微前倾的交流姿态，脊柱与重心自然，避免镜头畸变',
  },
  {
    id: 'stool-seated',
    label: '高凳坐姿',
    prompt: '坐在高凳上的模特姿势，一脚着地一脚轻收，服装垂坠自然',
  },
  {
    id: 'chair-seated',
    label: '端正坐姿',
    prompt: '椅上端正坐姿，双脚稳定着地，背部、髋部和衣料接触真实',
  },
  {
    id: 'seated-crossed-legs',
    label: '交腿坐姿',
    prompt: '正式交腿坐姿，膝踝关系自然，衣摆与裤装覆盖完整得体',
  },
  {
    id: 'seated-edge',
    label: '座沿前倾',
    prompt: '坐在座沿并轻微前倾，双手自然置于膝部，姿态专注稳重',
  },
  {
    id: 'side-seated',
    label: '侧向坐姿',
    prompt: '身体侧向的优雅坐姿，双腿自然并拢，服装覆盖完整且褶皱可信',
  },
  {
    id: 'floor-seated',
    label: '地面盘坐',
    prompt: '地面自然盘坐姿势，髋膝踝结构准确，衣物受压与铺展合理',
  },
  {
    id: 'one-knee',
    label: '单膝跪姿',
    prompt: '单膝着地姿势，另一脚稳定支撑，膝甲、裤装和鞋靴结构完整',
  },
  { id: 'crouch', label: '低位蹲姿', prompt: '低位蹲伏姿势，脚掌支撑、膝髋弯曲和身体平衡准确' },
  {
    id: 'a-pose',
    label: '标准 A-Pose',
    prompt: '标准 A-pose，双臂与躯干保持适度夹角，手掌自然，适合建模观察',
  },
  {
    id: 't-pose',
    label: '标准 T-Pose',
    prompt: '标准 T-pose，双臂水平展开，手掌向下，正交结构适合绑定参考',
  },
  {
    id: 'guard',
    label: '警戒姿势',
    prompt: '自然警戒姿势，双脚错开，双手准备行动，视线锁定画外目标',
  },
  {
    id: 'sword-ready',
    label: '持剑准备',
    prompt: '持剑准备姿势，握柄、手腕、剑身方向与身体重心协调',
  },
  {
    id: 'shield-block',
    label: '举盾格挡',
    prompt: '举盾格挡姿势，盾牌绑带和握持清楚，身体受力与防护朝向合理',
  },
  {
    id: 'bow-aim',
    label: '拉弓瞄准',
    prompt: '拉弓瞄准姿势，弓弦、搭箭、双肩和视线形成准确受力线',
  },
  {
    id: 'ranged-aim',
    label: '远程瞄准',
    prompt: '双手稳定操作远程武器，肩肘腕关系准确，视线与瞄准方向一致',
  },
  {
    id: 'staff-grounded',
    label: '法杖拄地',
    prompt: '单手持法杖拄地的稳定站姿，法杖接地点与手部握持关系清楚',
  },
  {
    id: 'two-hand-cast',
    label: '双手施法',
    prompt: '双手在身体前方或身侧形成明确施法手势，手指完整，能量不遮挡身体',
  },
  {
    id: 'summoning',
    label: '召唤姿势',
    prompt: '一手引导一手控制的召唤姿势，动作层级和能量路径清楚',
  },
  { id: 'sprint', label: '冲刺', prompt: '高速冲刺关键帧，躯干前倾、摆臂、蹬地与衣物动态方向一致' },
  {
    id: 'jump',
    label: '跃起',
    prompt: '跃起瞬间的完整身体姿势，四肢动作清楚，衣摆与发丝服从上升动势',
  },
  { id: 'landing', label: '落地', prompt: '落地缓冲关键帧，膝髋屈曲与手臂平衡合理，脚部完整接地' },
  { id: 'dodge', label: '闪避', prompt: '侧向闪避关键帧，身体倾斜、脚步方向与视觉动线一致' },
  { id: 'slash', label: '挥砍', prompt: '武器挥砍动作关键帧，动作弧线、双手握持和身体扭转准确' },
  {
    id: 'overhead-strike',
    label: '高举重击',
    prompt: '双手高举武器准备重击，肩肘结构完整，重心稳定且武器不出框',
  },
  {
    id: 'spear-thrust',
    label: '长枪突刺',
    prompt: '长柄武器突刺姿势，前后手距离、弓步和武器轴线准确',
  },
  {
    id: 'victory',
    label: '胜利姿势',
    prompt: '克制有力量的胜利姿势，身体打开，武器或道具展示清楚',
  },
  {
    id: 'command',
    label: '发号施令',
    prompt: '一手指向目标的指挥姿势，另一手控制装备，身体语言明确',
  },
  {
    id: 'inspect-tool',
    label: '检查装备',
    prompt: '低头检查手中工具或装备，视线、手指操作与道具结构准确',
  },
]

export const ASSET_TYPES = [
  {
    id: 'character',
    label: '角色',
    en: 'CHARACTER',
    icon: 'bi-person-bounding-box',
    placeholder: '描述角色：种族 / 职业 / 服装结构 / 配色 / 武器道具 / 气质…',
    defaultPrompt: '一名在浮空遗迹中探索的星轨机械师，服装结构清晰，装备可拆分，造型具有强记忆点',
    examples: [
      {
        label: '暗夜刺客',
        text: '身披暗紫斗篷的精灵刺客，双持短刃，轻甲与皮革混搭，冷色调，剪影凌厉',
      },
      {
        label: 'Q 版法师',
        text: '圆润可爱的 Q 版小法师，超大帽子遮住半张脸，发光法杖，明快糖果色',
      },
      { label: '重装骑士', text: '全身板甲的圣殿骑士，鎏金纹章，巨剑拄地，庄重史诗感' },
    ],
    aspects: ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'],
    defaultAspect: '3:4',
    controlGroups: [
      { id: 'composition', label: '构图与镜头', output: true },
      { id: 'identity', label: '角色塑造' },
      { id: 'face', label: '面部与发型' },
      { id: 'performance', label: '动作与表演' },
      { id: 'pose', label: '模特与精确姿势' },
      { id: 'wardrobe', label: '服装轮廓' },
      { id: 'garments', label: '服装单品' },
      { id: 'wearing', label: '分区穿戴' },
      { id: 'materials', label: '面料与护甲' },
      { id: 'craft', label: '工艺与状态' },
      { id: 'narrative', label: '阵营与特效' },
      { id: 'lighting', label: '灯光与色彩' },
      { id: 'production', label: '资产制作' },
      { id: 'reference', label: '参考图约束' },
    ],
    selects: [
      {
        key: 'framing',
        group: 'composition',
        label: '画面用途',
        options: [
          { id: 'full-body', label: '全身立绘', prompt: '完整全身立绘，主体居中无裁切，脚部完整' },
          {
            id: 'turnaround',
            label: '三视图',
            prompt: '同一角色的正面、侧面、背面三视图并排，比例严格一致',
          },
          { id: 'bust', label: '半身特写', prompt: '半身像特写，突出面部神态与上身服装细节' },
          {
            id: 'splash',
            label: '宣传立绘',
            prompt: '游戏宣传级角色立绘，构图具有叙事张力和强视觉焦点',
          },
          {
            id: 'portrait',
            label: '头像肖像',
            prompt: '肩部以上角色肖像，面部、发型与头部配饰完整清晰',
          },
          {
            id: 'action',
            label: '战斗关键帧',
            prompt: '完整角色战斗关键帧，动作方向明确，身体和装备不被裁切',
          },
          {
            id: 'orthographic',
            label: '建模正交图',
            prompt: '建模用正交角色展示，标准中性姿态，透视极弱，结构和材质分区清楚',
          },
        ],
      },
      {
        key: 'camera',
        group: 'composition',
        label: '镜头机位',
        options: [
          { id: 'auto', label: '智能机位', prompt: '' },
          {
            id: 'three-quarter',
            label: '经典 3/4',
            prompt: '经典三分之四视角，面部与身体结构同时清晰可见',
          },
          { id: 'eye-level', label: '平视', prompt: '平视机位，角色比例自然稳定' },
          {
            id: 'low-angle',
            label: '英雄仰角',
            prompt: '英雄视角的商业角色海报机位，镜头关注整体轮廓与装备，强化力量感',
          },
          { id: 'high-angle', label: '高机位', prompt: '轻微高机位俯拍，强化角色轮廓和叙事氛围' },
          {
            id: 'profile',
            label: '侧面',
            prompt: '清晰侧面机位，面部轮廓、身体重心和装备前后层次可读',
          },
          {
            id: 'rear-three-quarter',
            label: '背面 3/4',
            prompt: '背面三分之四机位，重点展示背部服装、携行和后侧轮廓',
          },
          {
            id: 'dynamic',
            label: '动态透视',
            prompt: '受控动态透视，强化动作纵深但避免肢体比例和武器尺寸畸变',
          },
        ],
      },
      {
        key: 'genderPresentation',
        group: 'identity',
        label: '性别表达',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'masculine',
            label: '男性',
            prompt: '男性角色表达，体态、面部结构与服装剪裁协调，避免刻板化夸张',
          },
          {
            id: 'feminine',
            label: '女性',
            prompt: '女性角色表达，体态、面部结构与服装剪裁协调，兼顾力量感与功能性',
          },
          {
            id: 'androgynous',
            label: '中性',
            prompt: '中性化角色表达，弱化传统性别符号，以轮廓、气质和身份建立辨识度',
          },
          {
            id: 'agender',
            label: '无性别',
            prompt: '无明确性别表达，以角色形态、职业和世界观语言主导设计',
          },
          {
            id: 'nonhuman',
            label: '非人表达',
            prompt: '非人类性别表达，不套用人类性征，遵循物种自身解剖与文化设定',
          },
        ],
      },
      {
        key: 'archetype',
        group: 'identity',
        label: '角色定位',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'hero', label: '主角', prompt: '主角定位，拥有鲜明识别点与可持续成长的视觉设计' },
          { id: 'companion', label: '伙伴', prompt: '核心伙伴定位，亲和但不抢夺主角视觉中心' },
          {
            id: 'villain',
            label: '反派',
            prompt: '主要反派定位，危险感与压迫感明确，动机气质可信',
          },
          { id: 'boss', label: '首领', prompt: 'Boss 首领定位，体量感强，拥有阶段性战斗设计线索' },
          { id: 'npc', label: 'NPC', prompt: '功能型 NPC 定位，职业和阵营信息一眼可读' },
          {
            id: 'rival',
            label: '宿敌',
            prompt: '核心宿敌定位，与主角形成可辨识的视觉对照和能力镜像',
          },
          {
            id: 'mentor',
            label: '导师',
            prompt: '导师角色定位，阅历、能力与可信权威感通过造型清晰表达',
          },
          {
            id: 'merchant',
            label: '商人',
            prompt: '商人或服务型角色定位，货品、职业工具与个性信息一眼可读',
          },
          {
            id: 'minion',
            label: '普通敌人',
            prompt: '量产敌人定位，阵营统一、战斗职能清楚且复杂度适合批量生产',
          },
        ],
      },
      {
        key: 'subjectForm',
        group: 'identity',
        label: '角色形态',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'humanoid',
            label: '人形',
            prompt: '人形或类人形角色，人体结构、关节与穿戴关系可信',
          },
          {
            id: 'creature',
            label: '生物',
            prompt: '非人类生物角色，解剖结构、运动方式与生态特征自洽',
          },
          {
            id: 'mechanical',
            label: '机械',
            prompt: '机械角色，关节、动力核心、装甲分件与功能结构合理',
          },
          {
            id: 'spirit',
            label: '灵体',
            prompt: '能量或灵体角色，实体轮廓可读，透明与发光层次受控',
          },
          {
            id: 'hybrid',
            label: '混合形态',
            prompt: '人类、生物或机械特征的混合形态，各系统过渡自然且主轮廓清楚',
          },
          {
            id: 'giant',
            label: '巨型生物',
            prompt: '巨型角色形态，以尺度参照、承重骨架和厚重结构表现体量',
          },
          {
            id: 'swarm',
            label: '群体聚合',
            prompt: '由多个单元聚合成单一角色轮廓，核心意识与群体结构层级明确',
          },
        ],
      },
      {
        key: 'species',
        group: 'identity',
        label: '种族物种',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'human', label: '人类', prompt: '人类角色，解剖比例与面部结构自然可信' },
          {
            id: 'elf',
            label: '精灵',
            prompt: '精灵族角色，耳部、骨相与优雅修长比例形成统一种族特征',
          },
          { id: 'dwarf', label: '矮人', prompt: '矮人族角色，紧凑强健体型与厚重工艺文化特征明确' },
          {
            id: 'beastfolk',
            label: '兽人/兽族',
            prompt: '兽人或兽族角色，动物特征与类人解剖自然融合，毛发分区合理',
          },
          {
            id: 'demon',
            label: '恶魔',
            prompt: '恶魔族角色，角、尾或异化结构具有清晰生长逻辑与轮廓秩序',
          },
          {
            id: 'undead',
            label: '亡灵',
            prompt: '亡灵角色，死亡特征克制可信，结构清晰且保持角色可读性',
          },
          {
            id: 'cyborg',
            label: '义体人',
            prompt: '义体改造角色，机械植入、接口和人体组织连接关系可信',
          },
          {
            id: 'robot',
            label: '机器人',
            prompt: '机器人角色，功能分件、关节活动与动力结构完整合理',
          },
          {
            id: 'alien',
            label: '外星种族',
            prompt: '外星智慧种族，非人解剖、文化装束与技术体系自洽',
          },
          { id: 'spirit', label: '灵体种族', prompt: '灵体种族，能量透光层次与实体锚点关系清晰' },
        ],
      },
      {
        key: 'gameplayRole',
        group: 'identity',
        label: '玩法职能',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'frontline',
            label: '前排/坦克',
            prompt: '前排承伤职能，防护轮廓、承重装备与稳定重心一眼可读',
          },
          {
            id: 'damage',
            label: '核心输出',
            prompt: '核心伤害职能，攻击方式、武器射程与弱防护区域逻辑明确',
          },
          {
            id: 'support',
            label: '治疗/辅助',
            prompt: '治疗或辅助职能，支援媒介、保护性形状与友方识别色清晰',
          },
          {
            id: 'control',
            label: '控制/法师',
            prompt: '控制或施法职能，技能媒介、施法手势与能量路径明确',
          },
          {
            id: 'noncombat',
            label: '非战斗',
            prompt: '非战斗职业职能，工具、工作服和身份道具服务于具体职业',
          },
          {
            id: 'assassin',
            label: '刺客',
            prompt: '高机动刺客职能，轻量防护、隐蔽装备和近身攻击方式清楚',
          },
          {
            id: 'ranged',
            label: '远程输出',
            prompt: '远程输出职能，射击姿态、弹药携行和攻击射程特征明确',
          },
          {
            id: 'summoner',
            label: '召唤',
            prompt: '召唤职能，召唤媒介、控制符号与伴生单位关系一眼可读',
          },
          {
            id: 'crafter',
            label: '制造/采集',
            prompt: '制造或采集职能，专业工具、防护服和材料收纳服务具体工作流程',
          },
        ],
      },
      {
        key: 'age',
        group: 'identity',
        label: '视觉年龄',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'young',
            label: '青年成人',
            prompt: '明确为二十岁以上青年成人的面部与身体年龄特征',
          },
          { id: 'adult', label: '成年', prompt: '成熟成年角色的面部与身体年龄特征' },
          { id: 'mature', label: '中年', prompt: '阅历丰富的中年角色特征，适度年龄纹理' },
          { id: 'elder', label: '长者', prompt: '高龄长者特征，年龄结构真实且保持角色魅力' },
          {
            id: 'ageless',
            label: '无龄感',
            prompt: '超自然无龄感角色，弱化现实年龄线索但保持面部结构真实稳定',
          },
        ],
      },
      {
        key: 'build',
        group: 'identity',
        label: '体型轮廓',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'balanced', label: '匀称', prompt: '匀称可信的身体比例，轮廓均衡' },
          { id: 'petite', label: '娇小', prompt: '娇小紧凑体型，骨架与四肢比例自然，避免儿童化' },
          {
            id: 'slender',
            label: '纤细',
            prompt: '纤细修长体型，骨架、肩胯与服装支撑关系自然可信',
          },
          { id: 'agile', label: '敏捷', prompt: '修长敏捷体型，动作轻盈，轮廓锐利' },
          {
            id: 'athletic',
            label: '健美',
            prompt: '均衡健美体型，肌肉线条服务于运动功能而不过度夸张',
          },
          {
            id: 'curvy',
            label: '丰盈',
            prompt: '健康圆润匀称的成年体态，整体比例自然，服装剪裁与受力关系准确',
          },
          { id: 'powerful', label: '强壮', prompt: '强壮有力体型，肌肉结构与装备承重合理' },
          { id: 'heavy', label: '厚重', prompt: '厚重高体量轮廓，稳定感与压迫感强' },
          {
            id: 'towering',
            label: '高挑',
            prompt: '高挑修长体型，长肢比例自然，保持稳定重心与可信解剖',
          },
          { id: 'compact', label: '敦实', prompt: '敦实紧凑体型，低重心、宽躯干与承重结构可信' },
        ],
      },
      {
        key: 'proportion',
        group: 'identity',
        label: '比例风格',
        options: [
          { id: 'auto', label: '匹配描述', prompt: '' },
          { id: 'realistic', label: '写实比例', prompt: '接近真实人体的自然比例与解剖结构' },
          { id: 'heroic', label: '英雄比例', prompt: '适度拉长的英雄比例，肩颈与四肢更具力量美感' },
          { id: 'stylized', label: '风格化', prompt: '风格化角色比例，形体夸张但结构自洽' },
          { id: 'chibi', label: 'Q 版', prompt: 'Q 版大头短身比例，轮廓可爱且细节简洁可读' },
          {
            id: 'fashion',
            label: '时装比例',
            prompt: '偏时装插画的修长比例，头身、肩胯与长肢关系优雅稳定',
          },
          {
            id: 'creature',
            label: '生物比例',
            prompt: '依据物种运动方式设计非人体比例，骨架、关节和承重关系自洽',
          },
        ],
      },
      {
        key: 'faceShape',
        group: 'face',
        label: '面部结构',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'soft', label: '柔和', prompt: '柔和流畅的面部结构与轮廓转折' },
          { id: 'angular', label: '棱角', prompt: '棱角分明的骨相与面部轮廓，结构清晰' },
          { id: 'rugged', label: '硬朗', prompt: '硬朗粗粝的面部结构，保留真实皮肤与年龄细节' },
          { id: 'round', label: '圆润', prompt: '圆润饱满的面部轮廓，五官排布自然且具有亲和感' },
          { id: 'long', label: '修长', prompt: '修长面部比例，颧骨、下颌和五官纵向关系协调' },
          {
            id: 'elegant',
            label: '精致',
            prompt: '精致优雅的骨相与五官结构，细节克制并保持自然质感',
          },
          { id: 'stylized', label: '风格化', prompt: '风格化面部比例，五官夸张但身份稳定且不崩坏' },
          {
            id: 'nonhuman',
            label: '非人面部',
            prompt: '非人面部结构，感官器官与骨骼关系符合物种设定并保持情绪可读',
          },
        ],
      },
      {
        key: 'hairDesign',
        group: 'face',
        label: '发型轮廓',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'short', label: '短发', prompt: '短发大形清晰，发束方向服从头部结构' },
          {
            id: 'shaved',
            label: '剃发/寸头',
            prompt: '剃发或极短寸头，头型轮廓清楚，发际线与毛茬质感自然',
          },
          { id: 'bob', label: '短鲍勃', prompt: '短鲍勃发型，发尾体积与面部包裹关系自然清楚' },
          { id: 'long', label: '长发', prompt: '长发轮廓具有流动感，发丝层级清晰且不遮挡主体结构' },
          { id: 'curly', label: '卷发', prompt: '卷发体积与卷曲层级清楚，发束不粘连成无结构块面' },
          {
            id: 'ponytail',
            label: '马尾/束发',
            prompt: '马尾或束发结构，固定方式、重量和动态方向合理',
          },
          {
            id: 'braided',
            label: '编发',
            prompt: '清晰编发结构，编织路径、发饰固定和发束厚度一致',
          },
          { id: 'updo', label: '盘发', prompt: '盘发造型，固定结构、装饰和头颈轮廓协调统一' },
          {
            id: 'nonhuman',
            label: '非人冠饰',
            prompt: '以角、羽冠、触须或能量冠替代人类发型，生长结构符合物种设定',
          },
        ],
      },
      {
        key: 'facialDetail',
        group: 'face',
        label: '面部记忆点',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'clean', label: '干净', prompt: '面部保持干净克制，依靠五官比例建立识别度' },
          { id: 'scar', label: '伤痕', prompt: '加入有叙事意义的伤痕，位置合理且不过度猎奇' },
          {
            id: 'marking',
            label: '纹身/印记',
            prompt: '加入阵营纹身或能量印记，图形设计与世界观统一',
          },
          { id: 'makeup', label: '妆容', prompt: '具有角色身份感的妆容，色彩与服装主色呼应' },
          {
            id: 'freckles',
            label: '雀斑/肤色细节',
            prompt: '加入自然雀斑、色素或肤色变化，分布符合真实皮肤特征',
          },
          {
            id: 'facial-hair',
            label: '胡须',
            prompt: '胡须造型与脸型、年龄和职业协调，毛发层次与边界自然',
          },
          {
            id: 'prosthetic',
            label: '义眼/义面',
            prompt: '加入义眼或局部面部义体，接口、材质和功能结构可信',
          },
          {
            id: 'ornament',
            label: '面饰/穿孔',
            prompt: '加入克制的面部饰品或穿孔，位置合理并服务身份表达',
          },
        ],
      },
      {
        key: 'poseCategory',
        group: 'pose',
        label: '姿势方向',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'fashion',
            label: '时装模特',
            prompt: '采用专业时装模特姿势，肢体线条舒展，完整展示服装版型与材质',
          },
          {
            id: 'commercial',
            label: '商业展示',
            prompt: '采用自然亲和的商业人物展示姿势，动作克制，服装和产品信息清楚',
          },
          {
            id: 'editorial',
            label: '杂志大片',
            prompt: '采用高级时装杂志式姿势，轮廓有张力但身体结构与重心真实',
          },
          {
            id: 'formal',
            label: '正式肖像',
            prompt: '采用正式人物肖像姿势，身体语言稳重，肩颈与手部摆放自然',
          },
          {
            id: 'casual',
            label: '生活自然',
            prompt: '采用自然生活化姿势，避免僵硬摆拍，肢体接触与重心可信',
          },
          {
            id: 'combat',
            label: '战斗关键帧',
            prompt: '采用游戏战斗关键帧姿势，攻击方向和受力清楚，剪影可读',
          },
          {
            id: 'magic',
            label: '施法表演',
            prompt: '采用施法或能力展示姿势，手势清楚，特效不遮挡脸部与身体',
          },
          {
            id: 'movement',
            label: '运动动态',
            prompt: '采用行走、奔跑、跳跃或落地等运动关键帧，动作连贯可信',
          },
          {
            id: 'modeling',
            label: '建模标准',
            prompt: '采用适合建模与绑定观察的标准姿势，四肢分离，结构无遮挡',
          },
        ],
      },
      {
        key: 'exactPose',
        group: 'pose',
        label: '精确姿势',
        options: CHARACTER_POSE_OPTIONS,
      },
      {
        key: 'expression',
        group: 'performance',
        label: '面部表情',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'determined', label: '坚定', prompt: '坚定专注的表情，眼神方向明确' },
          { id: 'calm', label: '冷静', prompt: '冷静克制的表情，情绪细腻自然' },
          { id: 'fierce', label: '凌厉', prompt: '凌厉具有威胁感的表情，避免夸张变形' },
          { id: 'mysterious', label: '神秘', prompt: '神秘疏离的表情与目光，保留情绪解读空间' },
          { id: 'warm', label: '亲和', prompt: '自然亲和的表情，避免僵硬商业微笑' },
          { id: 'joyful', label: '喜悦', prompt: '真实自然的喜悦表情，眼周与嘴角肌肉关系协调' },
          {
            id: 'melancholy',
            label: '忧郁',
            prompt: '克制细腻的忧郁表情，通过眉眼与嘴角轻微变化表达',
          },
          {
            id: 'confident',
            label: '自信',
            prompt: '从容自信的表情，眼神稳定，避免夸张挑眉或僵硬笑容',
          },
          {
            id: 'exhausted',
            label: '疲惫',
            prompt: '战斗或旅途后的疲惫状态，眼神、呼吸与姿态相互呼应',
          },
        ],
      },
      {
        key: 'gaze',
        group: 'performance',
        label: '视线方向',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'camera', label: '看向镜头', prompt: '目光看向镜头，与观者建立直接联系' },
          { id: 'off-camera', label: '看向画外', prompt: '目光看向画外目标，形成叙事方向' },
          { id: 'target', label: '锁定目标', prompt: '目光锁定战斗或施法目标，与身体动作方向一致' },
          { id: 'downcast', label: '垂眸', prompt: '视线轻微向下，塑造内敛沉思的情绪' },
          { id: 'side', label: '侧目', prompt: '目光自然侧移，眼球、头部朝向和叙事目标关系准确' },
          { id: 'upward', label: '仰望', prompt: '视线向上方目标，头颈角度自然并形成明确叙事方向' },
          { id: 'closed', label: '闭眼', prompt: '自然闭眼状态，面部肌肉放松，适合冥想或施法情境' },
        ],
      },
      {
        key: 'costumeEra',
        group: 'wardrobe',
        label: '服装时代',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'ancient',
            label: '上古文明',
            prompt: '上古文明服饰语汇，原始纺织、金属饰件与仪式结构自洽',
          },
          {
            id: 'medieval',
            label: '中世纪',
            prompt: '中世纪服装结构，内衬、束带、罩衣与护甲穿着顺序准确',
          },
          {
            id: 'renaissance',
            label: '文艺复兴',
            prompt: '文艺复兴式剪裁、立体袖型与精致装饰，身份等级清晰',
          },
          {
            id: 'eastern',
            label: '东方古典',
            prompt: '东方古典服装结构，交领、系带、袍摆与层叠关系准确自然',
          },
          {
            id: 'victorian',
            label: '维多利亚',
            prompt: '维多利亚时期轮廓与精细剪裁，礼制结构和工业细节融合',
          },
          {
            id: 'industrial',
            label: '工业时代',
            prompt: '工业时代工作装与机械配件语言，实用结构和耐磨工艺明确',
          },
          {
            id: 'contemporary',
            label: '现代',
            prompt: '现代服装版型与真实缝制结构，适度游戏化且可实际穿着',
          },
          {
            id: 'futuristic',
            label: '未来',
            prompt: '未来服装系统，模块化剪裁、智能材料与功能接口逻辑明确',
          },
          {
            id: 'postapocalyptic',
            label: '末世废土',
            prompt: '末世生存服装，回收拼接、防护层与维修痕迹服务实际功能',
          },
        ],
      },
      {
        key: 'coverageMode',
        group: 'wardrobe',
        label: '穿着覆盖',
        options: [
          {
            id: 'production-safe',
            label: '完整得体',
            prompt: '完整得体的公开发行级穿着，所有关键区域均由结构完整的不透明服装可靠覆盖',
          },
          {
            id: 'full-coverage',
            label: '全覆盖',
            prompt: '高覆盖度穿着，长袖长裤或长袍配合封闭领口，全部关键身体区域完整覆盖',
          },
          {
            id: 'layered',
            label: '多层防护',
            prompt: '不透明打底层、中层服装与外层护具完整叠穿，不出现缺失衣物的区域',
          },
          {
            id: 'practical',
            label: '实用轻装',
            prompt: '适合活动的实用轻装，保持完整上装、下装和安全打底，版型连续得体',
          },
          {
            id: 'formal',
            label: '正式礼装',
            prompt: '正式得体礼装，领口、袖笼、腰线与裙裤覆盖完整，配有可靠内衬',
          },
          {
            id: 'armored',
            label: '全套护甲',
            prompt: '完整护甲穿戴，软质内衬覆盖装甲缝隙，躯干与四肢防护连续',
          },
          {
            id: 'stage-safe',
            label: '舞台造型',
            prompt: '具有舞台张力但适合公开展示的完整造型，所有装饰开口下方均有不透明打底层',
          },
        ],
      },
      {
        key: 'baseLayer',
        group: 'wardrobe',
        label: '安全打底层',
        options: [
          {
            id: 'opaque',
            label: '不透明打底',
            prompt: '全身关键区域使用合体不透明打底层，作为薄料、开衩、镂空和护甲缝隙下的可靠覆盖',
          },
          {
            id: 'shirt-shorts',
            label: '上衣+安全裤',
            prompt: '内层穿着不透明贴身上衣与安全短裤，外层服装移动时仍保持完整覆盖',
          },
          {
            id: 'undersuit',
            label: '连体内衬',
            prompt: '穿着结构完整的不透明功能型连体内衬，关节区域保留活动性',
          },
          {
            id: 'gambeson',
            label: '武装棉甲',
            prompt: '护甲下穿完整武装棉甲，领口、袖窿、腰部与裤装连接连续严密',
          },
          {
            id: 'thermal',
            label: '保暖内层',
            prompt: '穿着完整保暖内层，袖口、领口和裤脚与外层装备自然衔接',
          },
          {
            id: 'compression',
            label: '运动内层',
            prompt: '穿着厚实不透明的运动功能内层，外层装备按功能分区覆盖',
          },
          {
            id: 'robe-lining',
            label: '袍服内衬',
            prompt: '长袍与裙装配有完整不透明内衬和安全裤，开衩与飘动状态仍然得体',
          },
          {
            id: 'tech-mesh-lined',
            label: '科技内衬',
            prompt: '科技服装使用不透明内衬，网眼与发光层仅位于内衬外侧或非敏感区域',
          },
          {
            id: 'nonhuman-cover',
            label: '异形防护层',
            prompt: '非人角色按物种结构配置完整防护覆盖，不将未着装的人体特征套用于异形身体',
          },
        ],
      },
      {
        key: 'detailDensity',
        group: 'wardrobe',
        label: '细节密度',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'production',
            label: '生产均衡',
            prompt: '生产可控的中等细节密度，主次关系明确，避免无意义碎细节',
          },
          {
            id: 'restrained',
            label: '简洁',
            prompt: '克制简洁的形面与装饰，依靠轮廓和配色建立识别度',
          },
          { id: 'rich', label: '丰富', prompt: '丰富但有秩序的服装、材质和工艺细节' },
          {
            id: 'ornate',
            label: '华丽',
            prompt: '高密度华丽装饰，纹样与结构服从角色身份和视觉焦点',
          },
        ],
      },
      {
        key: 'equipment',
        group: 'wardrobe',
        label: '装备展示',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'signature',
            label: '标志武器',
            prompt: '清晰展示一件标志性主武器或核心道具，与角色设计语言统一',
          },
          { id: 'none', label: '无武器', prompt: '不展示武器，把视觉重点集中在角色本体与服装' },
          { id: 'dual', label: '双持装备', prompt: '展示成对或双持装备，左右关系明确且不遮挡身体' },
          {
            id: 'loadout',
            label: '完整配装',
            prompt: '展示完整战斗配装，主副武器、收纳和携行位置合理',
          },
          {
            id: 'sword-shield',
            label: '剑盾',
            prompt: '剑盾组合装备，持握、盾牌绑带与收纳位置符合战斗逻辑',
          },
          {
            id: 'ranged',
            label: '远程武器',
            prompt: '清晰展示弓弩或枪械等远程武器，弹药与携行系统完整',
          },
          {
            id: 'staff',
            label: '法杖/媒介',
            prompt: '展示法杖、法器或施法媒介，尺寸、握持与能量路径合理',
          },
          {
            id: 'tools',
            label: '职业工具',
            prompt: '展示与职业匹配的工具组，功能、收纳和使用磨损细节可信',
          },
          {
            id: 'companion',
            label: '伴生装置',
            prompt: '展示小型伴生装置、无人机或召唤物，与主体层级清楚且不遮挡角色',
          },
        ],
      },
      {
        key: 'fitSilhouette',
        group: 'wardrobe',
        label: '服装廓形',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'fitted', label: '合体', prompt: '合体剪裁，准确贴合身体结构并保留关节活动余量' },
          {
            id: 'relaxed',
            label: '宽松',
            prompt: '宽松自然廓形，垂坠、堆叠与身体间空气层关系可信',
          },
          {
            id: 'structured',
            label: '挺括',
            prompt: '挺括结构化廓形，支撑、衬里与边缘保持清晰体积',
          },
          {
            id: 'oversized',
            label: '超大廓形',
            prompt: '有意设计的超大廓形，肩线、袖长与重心受控，不显得尺码错误',
          },
          {
            id: 'layered',
            label: '层叠',
            prompt: '丰富层叠廓形，各层长度、开口和固定关系清晰不粘连',
          },
          {
            id: 'flowing',
            label: '飘逸',
            prompt: '流动飘逸廓形，长摆和宽袖形成优美动势但不遮挡主体结构',
          },
          {
            id: 'armored',
            label: '装甲化',
            prompt: '装甲化外轮廓，硬质分件覆盖范围与软质活动区关系明确',
          },
        ],
      },
      {
        key: 'upperGarment',
        group: 'garments',
        label: '上装单品',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'shirt', label: '衬衫', prompt: '结构清楚的衬衫上装，领型、门襟、袖口和褶量准确' },
          { id: 'tunic', label: '束腰短袍', prompt: '束腰短袍上装，领口、腰带和开衩适合角色活动' },
          {
            id: 'blouse',
            label: '女式上衣',
            prompt: '成年女性专业制版上衣，结构线、领口和袖型自然合体，配有完整不透明内层',
          },
          {
            id: 'vest',
            label: '背心/马甲',
            prompt: '背心或马甲作为清晰中间层，肩袖开口与前襟结构合理',
          },
          { id: 'jacket', label: '短夹克', prompt: '短夹克上装，版型、拉链门襟和功能口袋结构明确' },
          {
            id: 'corset',
            label: '束身甲',
            prompt: '结构型外穿束身甲，内部搭配完整不透明上衣，支撑、系带与身体受力关系可信',
          },
          {
            id: 'robe-top',
            label: '交领上衣',
            prompt: '交领或袍式上装，衣襟覆盖、系带位置与袖型准确',
          },
          {
            id: 'armor-torso',
            label: '胸甲',
            prompt: '分件胸甲上装，胸腹活动、肩带固定与内衬关系清晰',
          },
          {
            id: 'bodysuit',
            label: '紧身战衣',
            prompt: '厚实不透明功能型贴身战衣，整体结构完整，拼接与弹性活动区准确',
          },
          {
            id: 'nonhuman',
            label: '异形上装',
            prompt: '适配非人躯干和附肢的定制上装，开口与固定结构符合解剖',
          },
        ],
      },
      {
        key: 'lowerGarment',
        group: 'garments',
        label: '下装单品',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'trousers', label: '长裤', prompt: '合体长裤，腰头、髋膝活动量与裤脚结构准确' },
          {
            id: 'tactical-pants',
            label: '战术裤',
            prompt: '战术长裤，耐磨拼片、护膝、口袋和束脚结构服务运动需求',
          },
          {
            id: 'shorts',
            label: '短裤',
            prompt: '功能型不透明短裤，版型覆盖完整，长度、开口和活动余量合理',
          },
          {
            id: 'skirt',
            label: '短裙',
            prompt: '结构清晰的短裙，内部配有不透明安全裤，下摆、褶量和动作状态自然',
          },
          {
            id: 'long-skirt',
            label: '长裙',
            prompt: '长裙或多片裙摆，腰线、开衩、层次与落地褶皱准确',
          },
          {
            id: 'split-skirt',
            label: '战斗裙甲',
            prompt: '分片战斗裙或裙甲，内部搭配完整不透明下装，活动范围与防护方向合理',
          },
          { id: 'robe-hem', label: '袍摆', prompt: '长袍下摆，前后片、侧开衩和内层裤装关系清楚' },
          {
            id: 'leg-armor',
            label: '腿甲',
            prompt: '分件腿甲，髋、膝、踝关节活动结构和绑带固定合理',
          },
          {
            id: 'nonhuman',
            label: '异形下装',
            prompt: '适配反关节、尾部或多足结构的定制下装，不套用错误人体版型',
          },
        ],
      },
      {
        key: 'onePieceGarment',
        group: 'garments',
        label: '连身服装',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'none',
            label: '上下分体',
            prompt: '不使用连身服装，以清晰的上装和下装分层组合为主',
          },
          {
            id: 'dress',
            label: '连衣裙',
            prompt: '完整不透明连衣裙结构，结构线、腰线、裙摆和开合方式自然合体',
          },
          {
            id: 'gown',
            label: '礼服长裙',
            prompt: '正式得体礼服长裙，完整内衬、支撑、裙摆体积和高级工艺层次清楚',
          },
          {
            id: 'robe',
            label: '长袍',
            prompt: '连身长袍，交叠衣襟、腰部固定、袖型与长下摆结构准确',
          },
          {
            id: 'eastern-robe',
            label: '东方袍服',
            prompt: '东方连身袍服，领型、衣襟、腰封和宽袖层次遵循传统结构再设计',
          },
          {
            id: 'jumpsuit',
            label: '连体工装',
            prompt: '连体工装，门襟、腰部调节、功能口袋和关节活动量合理',
          },
          {
            id: 'bodysuit',
            label: '连体战衣',
            prompt: '厚实不透明连体战衣，整体覆盖结构完整，弹性分区、防护拼片与人体运动线准确',
          },
          {
            id: 'ceremonial',
            label: '仪式服',
            prompt: '连身仪式服，身份符号、长摆与装饰秩序明确，穿着方式可信',
          },
          {
            id: 'nonhuman',
            label: '异形连身装',
            prompt: '为非人体型定制连身服装，附肢开口、闭合与活动结构准确',
          },
        ],
      },
      {
        key: 'outerwear',
        group: 'garments',
        label: '外搭',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'none', label: '无外搭', prompt: '不添加披风、外套或多余外搭，保持主体轮廓简洁' },
          { id: 'cloak', label: '斗篷', prompt: '带兜帽或肩扣的斗篷，固定点、厚度与垂坠动态可信' },
          {
            id: 'cape',
            label: '披风',
            prompt: '英雄式披风，肩部固定、长度和风向动态清晰，不遮挡装备',
          },
          { id: 'coat', label: '长外套', prompt: '长外套，翻领、门襟、后开衩与内外层关系准确' },
          { id: 'mantle', label: '肩披', prompt: '短肩披或仪式肩饰，重量、固定结构与身份装饰统一' },
          { id: 'shawl', label: '披肩', prompt: '柔软披肩或围裹层，纤维垂坠与身体接触关系自然' },
          {
            id: 'poncho',
            label: '斗篷衫',
            prompt: '实用斗篷衫或雨披，开口、下摆与装备穿出位置合理',
          },
          {
            id: 'tactical-shell',
            label: '战术外壳',
            prompt: '轻型防护外壳，模块接口、通风区和活动分区清晰',
          },
          { id: 'fur', label: '毛皮肩披', prompt: '毛皮肩披，皮板厚度、毛流和固定边缘真实自然' },
        ],
      },
      {
        key: 'footwear',
        group: 'wearing',
        label: '鞋靴',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'boots', label: '长靴', prompt: '长靴结构，靴筒、鞋面、鞋底与脚踝活动关系准确' },
          {
            id: 'combat-boots',
            label: '战术靴',
            prompt: '战术靴，系带、护踝、防滑鞋底与使用磨损可信',
          },
          {
            id: 'armored-boots',
            label: '装甲靴',
            prompt: '分片装甲靴，足部弯折、踝关节和小腿甲连接合理',
          },
          {
            id: 'shoes',
            label: '便鞋',
            prompt: '与时代和身份匹配的便鞋，鞋楦、鞋底与穿着结构清楚',
          },
          {
            id: 'heels',
            label: '高跟鞋靴',
            prompt: '稳定可行走的高跟鞋或跟靴，足部受力、鞋跟和姿态自然可信',
          },
          {
            id: 'sneakers',
            label: '运动鞋',
            prompt: '现代运动鞋，鞋面分片、缓震鞋底和系带结构真实',
          },
          {
            id: 'sandals',
            label: '凉鞋',
            prompt: '凉鞋或绑带鞋，绑带路径、脚部接触和鞋底厚度准确',
          },
          { id: 'barefoot', label: '赤足', prompt: '赤足呈现，足部结构、接地受力和脚趾自然完整' },
          {
            id: 'nonhuman',
            label: '异形足具',
            prompt: '为蹄、爪、反关节或机械足设计专用足具，结构匹配解剖',
          },
        ],
      },
      {
        key: 'headwear',
        group: 'wearing',
        label: '头部穿戴',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'none', label: '无头饰', prompt: '不添加帽子、头盔或冠饰，完整展示发型与头部轮廓' },
          { id: 'helmet', label: '头盔', prompt: '功能型头盔，视野、护颈、固定和开合结构合理' },
          { id: 'hood', label: '兜帽', prompt: '布质兜帽，开口、头部体积和颈肩连接关系自然' },
          { id: 'hat', label: '帽子', prompt: '与时代职业匹配的帽子，帽檐、帽冠和佩戴角度合理' },
          {
            id: 'crown',
            label: '王冠',
            prompt: '身份明确的王冠或冠冕，结构稳定，装饰集中且不过度堆砌',
          },
          {
            id: 'tiara',
            label: '头冠/发饰',
            prompt: '精致头冠或发饰，与发型固定方式和角色性别表达协调',
          },
          {
            id: 'halo',
            label: '悬浮冠饰',
            prompt: '悬浮光环或能量冠饰，与头部保持明确空间关系且不遮挡面部',
          },
        ],
      },
      {
        key: 'faceWear',
        group: 'wearing',
        label: '面部穿戴',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'none', label: '无面部穿戴', prompt: '不佩戴面具或眼镜，面部与双眼完整清晰' },
          {
            id: 'glasses',
            label: '眼镜',
            prompt: '佩戴结构真实的眼镜，镜腿、鼻托和镜片透光关系准确',
          },
          { id: 'goggles', label: '护目镜', prompt: '佩戴功能护目镜，固定带、镜框和防护范围合理' },
          {
            id: 'visor',
            label: '战术目镜',
            prompt: '佩戴战术或科技目镜，显示区域受控，不遮挡面部结构',
          },
          {
            id: 'half-mask',
            label: '半脸面具',
            prompt: '佩戴半脸面具，边缘贴合、绑带和呼吸开口结构清楚',
          },
          {
            id: 'full-mask',
            label: '全脸面具',
            prompt: '佩戴完整全脸面具，视窗、呼吸和开合结构具有功能逻辑',
          },
          {
            id: 'respirator',
            label: '呼吸面罩',
            prompt: '佩戴呼吸面罩，滤罐、软密封和头带连接准确',
          },
          {
            id: 'veil',
            label: '面纱',
            prompt: '佩戴礼仪面纱，面纱仅覆盖脸部外侧，身体服装仍有完整不透明内衬',
          },
        ],
      },
      {
        key: 'neckWear',
        group: 'wearing',
        label: '颈部穿戴',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'none', label: '简洁领口', prompt: '颈部保持简洁，领口结构完整且与上装自然衔接' },
          {
            id: 'high-collar',
            label: '高领',
            prompt: '结构清晰的高领，支撑、闭合与颈部活动余量合理',
          },
          {
            id: 'scarf',
            label: '围巾',
            prompt: '围巾绕法、结点与垂坠自然，不遮挡脸部和胸前核心设计',
          },
          { id: 'cravat', label: '领巾', prompt: '正式领巾或领结，打结结构与礼服领口协调' },
          {
            id: 'tie',
            label: '领带',
            prompt: '领带、衬衫领和领结位置准确，长度和垂坠符合身体姿态',
          },
          { id: 'gorget', label: '护颈甲', prompt: '金属或复合护颈甲，颈肩活动与胸甲连接结构合理' },
          { id: 'fur-collar', label: '毛领', prompt: '厚实毛领，毛流、底层与外套领口固定关系自然' },
          {
            id: 'tech-collar',
            label: '科技项圈',
            prompt: '功能型科技颈环，接口、状态灯与服装能源系统明确连接',
          },
        ],
      },
      {
        key: 'shoulderWear',
        group: 'wearing',
        label: '肩部穿戴',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'none', label: '无肩饰', prompt: '肩部不添加额外装饰，完整展示上装肩线和袖窿结构' },
          { id: 'epaulettes', label: '肩章', prompt: '制式肩章或流苏肩饰，固定位置与职级体系清晰' },
          { id: 'pauldrons', label: '肩甲', prompt: '分件肩甲，抬臂活动范围、绑带和胸甲连接合理' },
          {
            id: 'single-pauldron',
            label: '单侧肩甲',
            prompt: '单侧肩甲形成非对称焦点，防护方向与整体视觉重量平衡',
          },
          {
            id: 'fur-shoulder',
            label: '毛皮肩饰',
            prompt: '毛皮肩饰，毛流、皮板厚度和肩部固定结构清楚',
          },
          {
            id: 'tech-rig',
            label: '肩部模块',
            prompt: '肩部科技模块或传感器，接口与背部装备连接具有功能逻辑',
          },
          {
            id: 'organic-growth',
            label: '生物肩饰',
            prompt: '角质、植物或晶体肩部生长结构，根部连接与重量支撑可信',
          },
        ],
      },
      {
        key: 'armWear',
        group: 'wearing',
        label: '手臂穿戴',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'long-sleeves',
            label: '完整长袖',
            prompt: '完整长袖覆盖肩至手腕，袖山、肘部余量和袖口结构准确',
          },
          {
            id: 'rolled-sleeves',
            label: '卷袖',
            prompt: '袖口整齐卷至前臂，卷层厚度和两侧高度自然',
          },
          {
            id: 'detached-sleeves',
            label: '外搭袖套',
            prompt: '外搭袖套覆盖手臂并在肩部或上臂可靠固定，内层仍完整得体',
          },
          { id: 'bracers', label: '护腕', prompt: '皮革或复合护腕，绑带、贴合与手腕活动范围合理' },
          { id: 'vambraces', label: '前臂甲', prompt: '分件前臂甲，肘腕连接、内衬和扣带结构清楚' },
          {
            id: 'full-arm-armor',
            label: '全臂甲',
            prompt: '肩甲、上臂甲、肘甲和前臂甲连续穿戴，关节活动不冲突',
          },
          { id: 'wraps', label: '缠臂布', prompt: '整齐缠臂布带，缠绕方向、松紧和末端固定准确' },
          {
            id: 'prosthetic-arms',
            label: '机械义臂',
            prompt: '机械义臂或外骨骼手臂，关节、动力与服装接口合理',
          },
        ],
      },
      {
        key: 'handWear',
        group: 'wearing',
        label: '手部穿戴',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'bare-hands',
            label: '不戴手套',
            prompt: '双手不戴手套，手掌、手背和所有手指结构完整自然',
          },
          {
            id: 'leather-gloves',
            label: '皮手套',
            prompt: '合体皮手套，指缝、掌部弯折和腕口结构清楚',
          },
          {
            id: 'fingerless',
            label: '露指手套',
            prompt: '功能型露指手套，裁切边缘、护掌和外露手指结构完整',
          },
          {
            id: 'fabric-gloves',
            label: '布手套',
            prompt: '布质手套，缝线、褶皱和手指贴合关系自然',
          },
          {
            id: 'gauntlets',
            label: '金属护手',
            prompt: '分节金属护手，指甲片、关节片和腕甲活动结构准确',
          },
          {
            id: 'tactical-gloves',
            label: '战术手套',
            prompt: '战术手套，护指、护掌、腕带和持握摩擦区域明确',
          },
          {
            id: 'tech-gloves',
            label: '科技手套',
            prompt: '科技操作手套，传感区域、接口与手指关节分区合理',
          },
          {
            id: 'magic-gloves',
            label: '施法手套',
            prompt: '施法手套或符文护手，符号沿手背和手指关节有序分布',
          },
          {
            id: 'clawed-gauntlets',
            label: '爪型护手',
            prompt: '爪型护手适配手指数量和关节，爪尖方向与抓握功能可信',
          },
        ],
      },
      {
        key: 'waistWear',
        group: 'wearing',
        label: '腰部穿戴',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'simple-belt',
            label: '腰带',
            prompt: '结构简洁的腰带，带扣、穿带环和服装收束关系准确',
          },
          {
            id: 'utility-belt',
            label: '战术腰封',
            prompt: '战术腰带与模块挂点，重量分布、固定和快速取用合理',
          },
          { id: 'sash', label: '腰封/束带', prompt: '布质腰封或束带，缠绕、打结和垂带长度自然' },
          {
            id: 'corset-belt',
            label: '结构腰封',
            prompt: '外穿结构腰封，支撑与系带合理，内部有完整不透明上衣和下装',
          },
          {
            id: 'fauld',
            label: '腰甲',
            prompt: '腰甲与裙甲在腰部完整叠接，胸甲和腿甲连接层次清楚',
          },
          { id: 'rope-belt', label: '绳结腰带', prompt: '绳结腰带，结法、受力和挂件固定清楚' },
          {
            id: 'holster-rig',
            label: '携行腰挂',
            prompt: '武器套、工具袋和补给腰挂，左右重量与动作避让合理',
          },
          {
            id: 'tech-core',
            label: '腰部模块',
            prompt: '腰部能源或控制模块，接口、护壳与服装连接结构可信',
          },
        ],
      },
      {
        key: 'legWear',
        group: 'wearing',
        label: '腿部穿戴',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'trousers',
            label: '完整裤装',
            prompt: '不透明完整裤装覆盖腰部与双腿，髋膝活动量和裤脚结构准确',
          },
          {
            id: 'opaque-tights',
            label: '不透明打底裤',
            prompt: '厚实不透明打底裤作为裙装或袍服内层，腰胯和双腿覆盖完整',
          },
          {
            id: 'leggings',
            label: '运动紧身裤',
            prompt: '功能型不透明运动裤，面料厚实无透视，膝髋活动分区准确',
          },
          {
            id: 'stockings-lined',
            label: '长袜+安全层',
            prompt: '长袜作为外观层，内部同时配置版型完整的不透明安全裤',
          },
          {
            id: 'greaves',
            label: '胫甲',
            prompt: '胫甲覆盖小腿正面，膝踝活动、绑带和鞋靴衔接合理',
          },
          {
            id: 'knee-pads',
            label: '护膝',
            prompt: '功能护膝，位置对准髌骨，绑带和裤装受压关系自然',
          },
          {
            id: 'full-leg-armor',
            label: '全腿甲',
            prompt: '大腿甲、膝甲和胫甲完整分件，髋膝踝活动结构连续',
          },
          {
            id: 'leg-wraps',
            label: '绑腿',
            prompt: '布质或皮革绑腿，缠绕方向、松紧与鞋靴连接准确',
          },
          {
            id: 'prosthetic-legs',
            label: '机械义腿',
            prompt: '机械义腿或外骨骼腿部，髋膝踝关节和服装接口可信',
          },
        ],
      },
      {
        key: 'backWear',
        group: 'wearing',
        label: '背部穿戴',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'none',
            label: '背部简洁',
            prompt: '背部不添加大型挂载，完整展示服装背面剪裁与接缝',
          },
          { id: 'backpack', label: '背包', prompt: '功能背包，肩带、胸带、腰带和背部贴合关系准确' },
          { id: 'quiver', label: '箭袋', prompt: '背负箭袋，肩带固定、箭矢方向和取箭路径合理' },
          {
            id: 'weapon-sheath',
            label: '武器背挂',
            prompt: '背部武器鞘或磁吸挂架，重心、拔取方向和服装避让合理',
          },
          {
            id: 'jetpack',
            label: '推进背包',
            prompt: '推进背包，喷口、燃料或能源核心与身体隔热防护结构明确',
          },
          {
            id: 'banner',
            label: '背旗',
            prompt: '背负战旗或阵营旗帜，旗杆固定、布面动态与角色轮廓层级清楚',
          },
          {
            id: 'wings',
            label: '翼结构',
            prompt: '羽翼、机械翼或能量翼从肩胛区域合理连接，左右结构完整对称',
          },
          {
            id: 'tool-rig',
            label: '工具背架',
            prompt: '职业工具背架，夹具、绑带和工具尺寸符合携行与取用需求',
          },
        ],
      },
      {
        key: 'accessorySystem',
        group: 'garments',
        label: '配饰系统',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'restrained',
            label: '克制',
            prompt: '仅保留少量高识别度配饰，避免无意义挂件和视觉噪声',
          },
          {
            id: 'jewelry',
            label: '珠宝首饰',
            prompt: '珠宝首饰系统，佩戴位置、比例、材质和身份等级统一',
          },
          {
            id: 'belts-pouches',
            label: '腰带挂包',
            prompt: '实用腰带、挂包与收纳件，承重、开合和取用位置合理',
          },
          {
            id: 'religious',
            label: '宗教饰件',
            prompt: '宗教或仪式饰件，符号体系、佩戴秩序和材质等级明确',
          },
          {
            id: 'military',
            label: '军衔徽章',
            prompt: '军衔、勋章和部队徽章系统，位置规范且层级清晰',
          },
          {
            id: 'tech-modules',
            label: '科技模块',
            prompt: '可拆卸科技模块、接口与状态灯，功能分区和线缆走向明确',
          },
          {
            id: 'charms',
            label: '护符挂件',
            prompt: '护符、纪念物或小型挂件具有个人叙事，数量受控且固定合理',
          },
          {
            id: 'royal',
            label: '贵族礼饰',
            prompt: '贵族礼饰与身份配件，纹章、宝石和金属装饰形成完整秩序',
          },
          {
            id: 'survival',
            label: '生存挂载',
            prompt: '水壶、绳索、工具和补给等生存挂载，重量分布和快速取用合理',
          },
        ],
      },
      {
        key: 'primaryFabric',
        group: 'materials',
        label: '主面料',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'cotton-linen',
            label: '棉麻',
            prompt: '棉麻主面料，纤维纹理、透气感、自然褶皱与哑光表面清晰',
          },
          {
            id: 'wool-felt',
            label: '羊毛/毡呢',
            prompt: '羊毛或毡呢面料，厚实保暖、细密绒面与柔和轮廓可信',
          },
          {
            id: 'silk-satin',
            label: '真丝/缎面',
            prompt: '真丝或缎面，柔顺垂坠与方向性丝光准确，避免塑料反光',
          },
          {
            id: 'velvet',
            label: '天鹅绒',
            prompt: '天鹅绒面料，短绒吸光与角度变化高光细腻，体积厚度明确',
          },
          {
            id: 'brocade',
            label: '织锦',
            prompt: '织锦面料，底纹、提花与金线结构精细，纹样服从服装裁片',
          },
          {
            id: 'leather',
            label: '皮革',
            prompt: '天然皮革，粒面、厚度、弯折与边缘封边真实，不呈塑料质感',
          },
          { id: 'suede', label: '麂皮', prompt: '麂皮绒面，柔和粗糙度、摩擦色差和厚实垂坠自然' },
          {
            id: 'denim-canvas',
            label: '丹宁/帆布',
            prompt: '丹宁或帆布，粗纺纹理、耐磨厚度、接缝和褪色区域可信',
          },
          { id: 'knit', label: '针织', prompt: '针织面料，线圈结构、弹性、厚薄和边缘收口清楚' },
          {
            id: 'lace',
            label: '蕾丝',
            prompt: '蕾丝或镂空织物仅作局部外层装饰，下方始终有不透明内衬，纱线结构与透空边界清楚',
          },
          {
            id: 'chiffon',
            label: '雪纺叠层',
            prompt: '轻质雪纺作为完整不透明内衬外的装饰叠层，卷边、层次和垂坠准确',
          },
          {
            id: 'rubber',
            label: '橡胶涂层布',
            prompt: '功能型橡胶涂层织物，厚实不透明，受控光泽、弹性和接缝结构明确',
          },
          {
            id: 'tech-fabric',
            label: '科技织物',
            prompt: '高性能科技织物，防水涂层、微结构、弹性分区和功能拼接可信',
          },
        ],
      },
      {
        key: 'secondaryMaterial',
        group: 'materials',
        label: '辅材',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'none',
            label: '单一材质',
            prompt: '不额外添加抢眼辅材，依靠主材质厚薄和工艺变化建立层次',
          },
          {
            id: 'leather',
            label: '皮革包边',
            prompt: '以皮革作为包边、绑带和加固辅材，厚度和缝合关系真实',
          },
          { id: 'fur', label: '毛皮', prompt: '毛皮作为领口或衬里辅材，毛流、底绒和边缘过渡自然' },
          { id: 'mesh', label: '网眼', prompt: '功能网眼辅材，孔径、拉伸和通风区分布符合结构需求' },
          {
            id: 'rubber',
            label: '橡胶',
            prompt: '橡胶用于防滑、密封或缓冲区域，表面粗糙度与主材质区分明确',
          },
          {
            id: 'metal',
            label: '金属饰件',
            prompt: '金属扣件、链条或包角作为辅材，连接方式和受力关系合理',
          },
          {
            id: 'crystal',
            label: '晶体',
            prompt: '晶体作为受控视觉焦点，折射、厚度与镶嵌结构清楚',
          },
          {
            id: 'wood',
            label: '木质',
            prompt: '木质辅材，纹理沿结构方向生长，边缘、涂装与金属连接可信',
          },
          { id: 'bone', label: '骨角', prompt: '骨骼或角质辅材，生长纹理、磨制边缘与固定结构自洽' },
        ],
      },
      {
        key: 'armorMaterial',
        group: 'materials',
        label: '护甲材质',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'none', label: '无护甲', prompt: '不添加硬质护甲，以服装结构和软质防护为主' },
          {
            id: 'steel',
            label: '钢铁',
            prompt: '锻造钢铁护甲，板厚、卷边、铆接与受控金属反射真实',
          },
          { id: 'bronze', label: '青铜', prompt: '青铜护甲，暖色金属、铸造细节和局部氧化层次可信' },
          {
            id: 'chainmail',
            label: '锁子甲',
            prompt: '锁子甲环扣结构连续正确，重量垂坠与内衬支撑关系自然',
          },
          {
            id: 'lamellar',
            label: '札甲/鳞甲',
            prompt: '札甲或鳞甲片层叠方向、穿绳固定与关节活动范围准确',
          },
          {
            id: 'ceramic',
            label: '陶瓷装甲',
            prompt: '高强陶瓷装甲，硬质哑光表面、分件缝隙和内层缓冲清楚',
          },
          {
            id: 'carbon',
            label: '碳纤复合',
            prompt: '碳纤维复合装甲，编织纹理尺度准确，边缘层压与功能分件合理',
          },
          {
            id: 'gold',
            label: '鎏金护甲',
            prompt: '以鎏金或贵金属饰面强化身份，主体结构仍具可信厚度与磨损',
          },
          {
            id: 'crystal',
            label: '晶体护甲',
            prompt: '晶体护甲，晶面切割、内部结构、折射与实体固定方式可信',
          },
          {
            id: 'bone-chitin',
            label: '骨质/甲壳',
            prompt: '骨质或甲壳护甲，生物层片、厚度和身体连接符合生长逻辑',
          },
          {
            id: 'energy',
            label: '能量护甲',
            prompt: '能量护甲具有明确发生器、稳定边界与透明层次，不遮挡主体结构',
          },
        ],
      },
      {
        key: 'materialFinish',
        group: 'materials',
        label: '表面光泽',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'matte',
            label: '哑光',
            prompt: '整体以哑光粗糙表面为主，柔和散射光突出形体和纹理',
          },
          {
            id: 'satin',
            label: '柔光',
            prompt: '柔和缎光表面，低强度宽高光随结构变化，不产生廉价塑料感',
          },
          {
            id: 'glossy',
            label: '亮面',
            prompt: '受控亮面材质，清晰反射环境但保留底色、结构和微小粗糙度',
          },
          {
            id: 'metallic',
            label: '金属光泽',
            prompt: '金属区域反射与非金属区域明确分离，粗糙度变化真实',
          },
          {
            id: 'pearlescent',
            label: '珠光',
            prompt: '克制珠光或虹彩表面，随视角轻微变色，不覆盖材质细节',
          },
          {
            id: 'translucent',
            label: '透光装饰',
            prompt: '受控透光材质仅用于披风边缘、袖口或独立装饰件，主体服装保持完整不透明',
          },
          {
            id: 'emissive',
            label: '自发光',
            prompt: '自发光区域限定在功能纹路或能量节点，亮度受控且保留纹理',
          },
          {
            id: 'mixed',
            label: '混合层次',
            prompt: '哑光、柔光与金属高光按材质功能分区，形成清晰可辨的层次',
          },
        ],
      },
      {
        key: 'fabricWeight',
        group: 'craft',
        label: '面料厚薄',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'sheer',
            label: '轻质外层',
            prompt: '轻质外层织物搭配完整不透明打底服装，细小褶皱、叠色与柔软边缘真实',
          },
          { id: 'light', label: '轻薄', prompt: '轻薄面料，随动作产生密集柔软褶皱和明确飘动方向' },
          {
            id: 'medium',
            label: '中等',
            prompt: '中等厚度面料，兼具结构支撑与自然垂坠，褶皱尺度适中',
          },
          {
            id: 'heavy',
            label: '厚重',
            prompt: '厚重面料，宽大褶皱、强垂坠和清晰边缘厚度符合重力',
          },
          { id: 'rigid', label: '硬挺', prompt: '硬挺面料或衬料，轮廓支撑明显，折线少而结构清楚' },
        ],
      },
      {
        key: 'craftsmanship',
        group: 'craft',
        label: '制作工艺',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'tailored',
            label: '精裁',
            prompt: '高级精裁工艺，省道、接缝、衬里和边缘收口准确整洁',
          },
          {
            id: 'handmade',
            label: '手工缝制',
            prompt: '可见但整齐的手工缝线和轻微个体差异，保留真实制作感',
          },
          {
            id: 'embroidered',
            label: '刺绣',
            prompt: '刺绣纹样沿服装裁片合理排布，针脚密度、线材光泽和边缘清楚',
          },
          { id: 'quilted', label: '绗缝', prompt: '绗缝填充结构，压线图案、厚度与受压区域准确' },
          { id: 'pleated', label: '褶裥', prompt: '规则褶裥工艺，褶线方向、展开量和动态变形自然' },
          {
            id: 'woven',
            label: '编织',
            prompt: '编织或结绳工艺，交错结构连续，粗细和受力方向明确',
          },
          {
            id: 'engraved',
            label: '雕刻蚀纹',
            prompt: '护甲或饰件雕刻蚀纹，深度、边缘磨损与曲面走向准确',
          },
          {
            id: 'riveted',
            label: '铆接拼装',
            prompt: '铆钉、板件和连接带形成可信拼装工艺，受力点分布合理',
          },
          {
            id: 'patched',
            label: '补丁修复',
            prompt: '可见补丁、补缀和替换件，修复方法匹配材质并保留使用故事',
          },
          {
            id: 'seamless',
            label: '无缝成型',
            prompt: '未来无缝成型工艺，功能分区由织造、压胶或材料变化自然形成',
          },
          {
            id: 'organic-grown',
            label: '生长成型',
            prompt: '生物生长或魔法塑形工艺，纹理连续且与角色身体自然连接',
          },
        ],
      },
      {
        key: 'surfacePattern',
        group: 'craft',
        label: '纹样系统',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'none',
            label: '纯色无纹',
            prompt: '不添加装饰纹样，以剪裁、材质和色块关系建立视觉层次',
          },
          {
            id: 'geometric',
            label: '几何纹样',
            prompt: '有秩序的几何纹样，尺度统一并沿裁片和身体结构排布',
          },
          {
            id: 'heraldic',
            label: '纹章',
            prompt: '阵营纹章系统，核心符号、边饰与应用位置规范统一',
          },
          {
            id: 'floral',
            label: '植物纹样',
            prompt: '植物或藤蔓纹样，生长方向自然，疏密服务视觉焦点',
          },
          {
            id: 'animal',
            label: '兽纹',
            prompt: '抽象兽纹或图腾，服务种族文化与角色身份，不使用随机贴图',
          },
          {
            id: 'runes',
            label: '符文',
            prompt: '符文系统具有统一字形、阅读方向和能量逻辑，数量受控',
          },
          {
            id: 'camouflage',
            label: '迷彩',
            prompt: '环境适配迷彩图案，色阶、尺度和分区符合实际隐蔽需求',
          },
          {
            id: 'circuit',
            label: '电路纹路',
            prompt: '功能型电路或导能纹路，起点终点和模块连接关系明确',
          },
          {
            id: 'gradient',
            label: '渐变染色',
            prompt: '受控渐变或扎染效果沿面料和结构自然变化，边界干净',
          },
        ],
      },
      {
        key: 'surfaceCondition',
        group: 'craft',
        label: '表面状态',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'pristine', label: '崭新', prompt: '崭新洁净表面，工艺边缘锐利，避免塑料感' },
          { id: 'used', label: '使用痕迹', prompt: '适量真实使用痕迹集中在接触区、关节和边缘' },
          {
            id: 'weathered',
            label: '风化',
            prompt: '日晒、雨蚀与环境沉积集中在朝向面、边缘和低洼处',
          },
          {
            id: 'battle-worn',
            label: '战损',
            prompt: '可信战损、刮痕和修补痕迹，保持主体结构完整可读',
          },
          {
            id: 'ancient',
            label: '古旧',
            prompt: '年代久远的氧化、褪色和沉积痕迹，材质差异仍然清晰',
          },
          {
            id: 'patched',
            label: '反复修补',
            prompt: '多次修补与替换痕迹，线迹、补片和新旧材料差异符合使用历史',
          },
          {
            id: 'dirty',
            label: '泥尘环境',
            prompt: '受控泥尘、汗渍或烟灰集中在合理区域，不覆盖关键材质与结构',
          },
          {
            id: 'corroded',
            label: '腐蚀氧化',
            prompt: '金属腐蚀、氧化与涂层剥落遵循材质和环境规律，保持结构可读',
          },
        ],
      },
      {
        key: 'factionTone',
        group: 'narrative',
        label: '阵营气质',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'heroic', label: '英雄', prompt: '英雄阵营气质，开放稳定的形状语言与可信荣誉符号' },
          {
            id: 'dark',
            label: '暗黑',
            prompt: '暗黑危险阵营气质，尖锐压迫的形状语言但避免无意义堆刺',
          },
          { id: 'sacred', label: '神圣', prompt: '神圣秩序阵营气质，对称结构与仪式符号克制明确' },
          { id: 'rogue', label: '游侠', prompt: '自由游侠阵营气质，非对称实用装备与旅行痕迹丰富' },
          {
            id: 'military',
            label: '军团',
            prompt: '正规军团气质，制服规范、职级标识与制式装备体系清晰',
          },
          {
            id: 'royal',
            label: '王室',
            prompt: '王室贵族气质，纹章、礼制轮廓与高级工艺体现身份等级',
          },
          {
            id: 'tribal',
            label: '部族',
            prompt: '部族文化气质，天然材料、手工工艺与图腾符号体系自洽',
          },
          {
            id: 'arcane',
            label: '秘法组织',
            prompt: '秘法组织气质，学派符号、施法媒介与知识阶层特征明确',
          },
          {
            id: 'corrupted',
            label: '异化阵营',
            prompt: '受侵蚀或异化阵营气质，变化路径受控并保留原始身份线索',
          },
        ],
      },
      {
        key: 'worldLanguage',
        group: 'narrative',
        label: '世界观语汇',
        options: [
          { id: 'auto', label: '匹配描述', prompt: '' },
          {
            id: 'fantasy',
            label: '西方奇幻',
            prompt: '西方奇幻世界观造型语汇，历史服饰、护甲工艺与魔法符号自洽',
          },
          {
            id: 'eastern',
            label: '东方幻想',
            prompt: '东方幻想世界观造型语汇，传统结构转译与架空设计自然融合',
          },
          {
            id: 'scifi',
            label: '科幻未来',
            prompt: '科幻未来世界观造型语汇，材料、能源与功能结构遵循技术逻辑',
          },
          {
            id: 'postapocalyptic',
            label: '废土末世',
            prompt: '废土末世造型语汇，回收改造、维修痕迹与生存功能可信',
          },
          {
            id: 'contemporary',
            label: '现代都市',
            prompt: '现代都市造型语汇，真实服装结构与适度游戏化设计平衡',
          },
          {
            id: 'steampunk',
            label: '蒸汽工业',
            prompt: '蒸汽工业世界观，机械传动、黄铜钢铁与时代服饰结构融合可信',
          },
          {
            id: 'cyberpunk',
            label: '赛博都市',
            prompt: '赛博都市语汇，街头服饰、义体接口和高密度科技功能层次清楚',
          },
          {
            id: 'mythic',
            label: '神话史诗',
            prompt: '神话史诗语汇，神祇符号、古代工艺和超自然尺度统一',
          },
          {
            id: 'gothic',
            label: '哥特恐怖',
            prompt: '哥特恐怖语汇，尖拱、宗教礼制与衰败材质形成克制压迫感',
          },
          {
            id: 'solarpunk',
            label: '生态未来',
            prompt: '生态未来语汇，清洁技术、植物系统和轻量材料自然共生',
          },
        ],
      },
      {
        key: 'powerSource',
        group: 'narrative',
        label: '力量来源',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'none',
            label: '无特效',
            prompt: '不使用能量特效，完全依靠形体、材质与装备表达能力',
          },
          { id: 'magic', label: '魔法', prompt: '魔法能量来源明确，符文、施法媒介与颜色系统统一' },
          {
            id: 'technology',
            label: '科技',
            prompt: '科技动力来源明确，能源核心、导线与发光区域具有功能逻辑',
          },
          {
            id: 'nature',
            label: '自然',
            prompt: '自然元素力量，植物、风、水、火或岩石与角色结构自然融合',
          },
          {
            id: 'corruption',
            label: '侵蚀',
            prompt: '受控的侵蚀或异化力量，扩散路径和材质变化具有叙事逻辑',
          },
          {
            id: 'elemental',
            label: '元素',
            prompt: '明确单一或复合元素力量，能量颜色、运动形态和材质反应一致',
          },
          {
            id: 'divine',
            label: '神力',
            prompt: '神圣或神祇力量，象征图形、光照与仪式媒介形成统一系统',
          },
          {
            id: 'psychic',
            label: '精神力',
            prompt: '精神或心灵力量，以受控空间扭曲、符号和目光表现，不遮挡身体',
          },
          {
            id: 'biotech',
            label: '生物科技',
            prompt: '生物科技力量，活体组织、人工接口和能量循环关系可信',
          },
        ],
      },
      {
        key: 'vfxIntensity',
        group: 'narrative',
        label: '特效强度',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'subtle', label: '轻量', prompt: '轻量能量特效，仅强调关键视觉焦点，不遮挡角色' },
          { id: 'none', label: '关闭', prompt: '不添加环境粒子、能量光带或装饰特效' },
          { id: 'medium', label: '适中', prompt: '适中强度特效围绕动作与装备组织，主体保持清晰' },
          {
            id: 'strong',
            label: '强烈',
            prompt: '高强度宣传级特效，保留完整轮廓、面部和装备可读性',
          },
        ],
      },
      {
        key: 'lighting',
        group: 'lighting',
        label: '布光方式',
        options: [
          { id: 'auto', label: '自动布光', prompt: '' },
          {
            id: 'studio',
            label: '影棚光',
            prompt: '中性柔和影棚布光，材质、肤色和服装细节均清晰可辨',
          },
          { id: 'cinematic', label: '电影光', prompt: '电影感主辅光关系，明暗层次塑造角色气质' },
          { id: 'rim', label: '轮廓光', prompt: '清晰轮廓光分离主体与背景，边缘不过曝' },
          { id: 'dramatic', label: '戏剧光', prompt: '强方向性戏剧布光，保留暗部结构与关键细节' },
          {
            id: 'overcast',
            label: '阴天漫射',
            prompt: '阴天柔和漫射光，肤色、面料和细节层次均匀清楚',
          },
          { id: 'sunset', label: '日落逆光', prompt: '日落暖色逆光与冷色环境补光平衡，边缘不过曝' },
          { id: 'neon', label: '霓虹光', prompt: '受控彩色霓虹光，主次色光明确并保留准确材质底色' },
          {
            id: 'volumetric',
            label: '体积光',
            prompt: '克制体积光束与空气层次，强化轮廓但不雾化主体细节',
          },
        ],
      },
      {
        key: 'colorDirection',
        group: 'lighting',
        label: '色彩关系',
        options: [
          { id: 'auto', label: '匹配描述', prompt: '' },
          { id: 'balanced', label: '自然平衡', prompt: '自然平衡配色，主色、辅色和强调色比例清晰' },
          {
            id: 'warm-cool',
            label: '冷暖对比',
            prompt: '冷暖色对比明确，色温服务于角色阵营与情绪',
          },
          {
            id: 'complementary',
            label: '互补色',
            prompt: '克制的互补色关系，强调色集中在视觉焦点',
          },
          {
            id: 'monochrome',
            label: '单色强调',
            prompt: '近似色主导，使用少量高纯度强调色建立记忆点',
          },
          {
            id: 'analogous',
            label: '邻近色',
            prompt: '邻近色配色建立统一气质，通过明度和纯度区分服装层级',
          },
          {
            id: 'triadic',
            label: '三色组',
            prompt: '受控三色关系，主辅强调色比例清楚，避免平均分配',
          },
          {
            id: 'muted',
            label: '低饱和',
            prompt: '低饱和综合色调，以材质、明度和少量强调色保持识别度',
          },
          {
            id: 'high-contrast',
            label: '高对比',
            prompt: '高明度或高纯度对比集中在角色焦点，轮廓和功能区一眼可读',
          },
        ],
      },
      {
        key: 'background',
        group: 'lighting',
        label: '背景呈现',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'studio', label: '纯色影棚', prompt: '克制纯色影棚背景，主体与背景明度清晰分离' },
          {
            id: 'gradient',
            label: '渐变氛围',
            prompt: '简洁渐变氛围背景，不出现抢夺主体的具体物件',
          },
          {
            id: 'environment',
            label: '叙事场景',
            prompt: '与角色身份匹配的简化叙事场景，背景细节服从主体',
          },
          {
            id: 'graphic',
            label: '平面图形',
            prompt: '克制平面图形背景，以形状和色块衬托角色，不出现文字和品牌元素',
          },
          { id: 'fog', label: '雾化空间', prompt: '简洁雾化空间背景，保留脚底接触与主体轮廓分离' },
          {
            id: 'workshop',
            label: '设定稿底板',
            prompt: '专业角色设定稿底板，背景中性干净，便于观察结构和材质',
          },
        ],
      },
      {
        key: 'variationMode',
        group: 'production',
        label: '批次策略',
        requiresBatch: true,
        options: [
          {
            id: 'balanced',
            label: '平衡探索',
            prompt: '批量结果保持同一需求，每张探索不同但合理的设计方向',
          },
          {
            id: 'diverse',
            label: '扩大差异',
            prompt: '批量结果显著改变轮廓、服装结构与配色方向，避免近似复制',
          },
          {
            id: 'consistent',
            label: '锁定角色',
            prompt: '批量结果严格保持同一角色身份、脸部、体型和核心服装，只改变姿态或细节方案',
          },
          {
            id: 'costume',
            label: '服装变体',
            prompt: '批量结果保持同一角色身份和体型，重点探索同世界观下的服装变体',
          },
        ],
      },
      {
        key: 'referenceFidelity',
        group: 'reference',
        label: '还原强度',
        requiresReference: true,
        options: [
          {
            id: 'balanced',
            label: '平衡还原',
            prompt: '保留参考图身份、脸部、轮廓与核心服装，同时进行生产级优化',
          },
          {
            id: 'strict',
            label: '严格还原',
            prompt: '严格保持参考图角色身份、脸部、发型、体型、服装和配色，不重新设计',
          },
          {
            id: 'identity',
            label: '锁定身份',
            prompt: '锁定参考图人物身份和脸部特征，允许重新设计服装、装备与姿态',
          },
          {
            id: 'inspiration',
            label: '仅作灵感',
            prompt: '仅提取参考图的视觉气质与设计语言，不复制具体身份和造型',
          },
        ],
      },
    ],
    toggles: [
      {
        key: 'transparent',
        group: 'composition',
        label: '透明背景',
        icon: 'bi-transparency',
        prompt: '纯净透明背景，主体边缘干净',
      },
      {
        key: 'visibleFace',
        group: 'production',
        label: '面部无遮挡',
        icon: 'bi-person-bounding-box',
        prompt: '脸部和双眼清晰可见，不被头发、特效、武器或阴影遮挡',
      },
      {
        key: 'visibleHands',
        group: 'production',
        label: '双手完整',
        icon: 'bi-hand-index',
        prompt: '双手完整可见，手指结构自然，持握关系正确，不被裁切',
      },
      {
        key: 'modularParts',
        group: 'production',
        label: '支持拆件',
        icon: 'bi-boxes',
        prompt: '服装、护甲、武器和挂件分层明确，连接点清楚，适合后续建模拆件',
      },
    ],
    line: '游戏角色概念设计，轮廓剪影可识别，服装与装备结构清晰可拆解，适合建模与立绘使用。',
    shareCategory: 'illustration',
  },
  {
    id: 'environment',
    label: '场景',
    en: 'ENVIRONMENT',
    icon: 'bi-image',
    placeholder: '描述场景：地点 / 建筑结构 / 标志物 / 氛围 / 色调…',
    defaultPrompt: '悬浮在云海之上的古代遗迹群，断裂石桥与青铜巨门，藤蔓缠绕，神秘幽蓝辉光',
    examples: [
      { label: '雨夜霓虹街', text: '赛博朋克雨夜街道，霓虹招牌倒映在积水路面，蒸汽从井盖升起' },
      { label: '雪山营地', text: '暴风雪中的登山者营地，帐篷透出暖光，远处冰峰高耸' },
      { label: '地下宝库', text: '堆满金币与神器的地下宝库，火把光影摇曳，巨龙盘踞暗处' },
    ],
    aspects: ['16:9', '3:2', '1:1'],
    defaultAspect: '16:9',
    controlGroups: [
      { id: 'composition', label: '空间与构图', output: true },
      { id: 'world', label: '世界与建筑' },
      { id: 'lighting', label: '天气与灯光' },
      { id: 'production', label: '关卡制作' },
    ],
    selects: [
      {
        key: 'view',
        group: 'composition',
        label: '视角',
        options: [
          { id: 'wide', label: '广角全景', prompt: '广角全景构图，前中后景层次分明，有视觉引导线' },
          { id: 'isometric', label: '等距俯瞰', prompt: '等距 isometric 视角，适合策略与模拟游戏' },
          { id: 'side', label: '横版卷轴', prompt: '横版卷轴游戏场景，可行走平台层次清晰' },
          { id: 'topdown', label: '俯视地图', prompt: '自上而下俯视角，适合 RPG 地图与关卡俯瞰' },
        ],
      },
      {
        key: 'shotScale',
        group: 'composition',
        label: '空间尺度',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'intimate',
            label: '局部空间',
            prompt: '聚焦一个可游玩的局部空间，入口、路径与互动区域关系清晰',
          },
          {
            id: 'medium',
            label: '区域场景',
            prompt: '中等尺度区域场景，核心建筑与周边功能空间层级明确',
          },
          {
            id: 'epic',
            label: '史诗大景',
            prompt: '史诗级大尺度环境，地标、地形与远景形成强烈尺度对比',
          },
        ],
      },
      {
        key: 'biome',
        group: 'world',
        label: '生态地貌',
        options: [
          { id: 'auto', label: '匹配描述', prompt: '' },
          {
            id: 'urban',
            label: '城市聚落',
            prompt: '城市或聚落生态，交通、生活设施与功能分区可信',
          },
          {
            id: 'forest',
            label: '森林自然',
            prompt: '森林自然生态，植被层级、地表湿度与生长规律自洽',
          },
          {
            id: 'desert',
            label: '荒漠废土',
            prompt: '荒漠或废土生态，风蚀、沉积与生存设施逻辑明确',
          },
          {
            id: 'snow',
            label: '冰雪高寒',
            prompt: '冰雪高寒生态，积雪厚度、冰面反射与抗寒结构可信',
          },
          {
            id: 'underground',
            label: '地下洞窟',
            prompt: '地下洞窟生态，岩层结构、人工通道与光源来源合理',
          },
        ],
      },
      {
        key: 'architecture',
        group: 'world',
        label: '建筑语汇',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'fantasy',
            label: '奇幻文明',
            prompt: '奇幻文明建筑语汇，结构、工艺与魔法元素统一',
          },
          {
            id: 'eastern',
            label: '东方架空',
            prompt: '东方架空建筑语汇，传统构件与幻想尺度自然融合',
          },
          {
            id: 'scifi',
            label: '科幻工业',
            prompt: '科幻工业建筑语汇，能源、运输与维护结构符合功能逻辑',
          },
          {
            id: 'ruins',
            label: '遗迹废墟',
            prompt: '遗迹废墟语汇，坍塌受力、年代痕迹与可探索路径可信',
          },
          {
            id: 'contemporary',
            label: '现代都市',
            prompt: '现代都市建筑语汇，真实尺度与游戏化识别点平衡',
          },
        ],
      },
      {
        key: 'mood',
        group: 'lighting',
        label: '时间氛围',
        options: [
          { id: 'day', label: '白昼', prompt: '白昼明亮自然光照' },
          { id: 'dusk', label: '黄昏', prompt: '黄昏暖色逆光，长投影' },
          { id: 'night', label: '夜晚', prompt: '夜晚冷色基调与人工光源点缀' },
          { id: 'storm', label: '雨雾', prompt: '雨雾弥漫的湿润氛围，空气透视强' },
        ],
      },
      {
        key: 'weather',
        group: 'lighting',
        label: '天气状态',
        options: [
          { id: 'clear', label: '晴朗', prompt: '晴朗稳定天气，空气通透，空间结构清晰可读' },
          { id: 'overcast', label: '阴天', prompt: '阴天柔和漫射光，材质色彩稳定，暗部保留细节' },
          { id: 'rain', label: '降雨', prompt: '可信降雨与湿润表面反射，雨幕不遮挡关键地标' },
          { id: 'snow', label: '降雪', prompt: '降雪与积雪关系可信，路径和可交互区域仍清晰' },
          { id: 'fog', label: '薄雾', prompt: '受控薄雾建立纵深，前中后景分离且不吞没主体结构' },
        ],
      },
      {
        key: 'pathReadability',
        group: 'production',
        label: '路径可读性',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'clear', label: '主路明确', prompt: '主行进路径通过地面、光照和构图引导清晰表达' },
          {
            id: 'branching',
            label: '多路径',
            prompt: '主支路线层级明确，每条路径拥有独立视觉线索',
          },
          { id: 'arena', label: '战斗区域', prompt: '战斗区域边界、掩体、制高点与出入口关系清楚' },
          {
            id: 'exploration',
            label: '探索导向',
            prompt: '利用地标、光源和高低差引导探索，保留发现感',
          },
        ],
      },
      {
        key: 'detailDensity',
        group: 'production',
        label: '细节密度',
        options: [
          { id: 'balanced', label: '生产均衡', prompt: '中等可控细节密度，大中小形体层级明确' },
          { id: 'clean', label: '低密度', prompt: '低细节密度与清晰大形，适合移动端和远景读取' },
          { id: 'rich', label: '高密度', prompt: '高细节环境叙事，但路径、地标与视觉焦点保持清楚' },
        ],
      },
    ],
    toggles: [
      {
        key: 'landmark',
        group: 'production',
        label: '强化地标',
        icon: 'bi-geo-alt',
        prompt: '设置一个清晰唯一的核心地标，远距离也能识别方向',
      },
      {
        key: 'modularKit',
        group: 'production',
        label: '模块化搭建',
        icon: 'bi-boxes',
        prompt: '建筑和环境资产按模块化套件设计，重复构件尺度统一且组合自然',
      },
      {
        key: 'cleanPlate',
        group: 'production',
        label: '无角色净景',
        icon: 'bi-person-slash',
        prompt: '不出现抢镜角色或前景人物，保持可用于环境制作的干净场景底图',
      },
    ],
    line: '游戏场景概念图，空间纵深与视觉引导明确，光影氛围完整，可作为关卡美术基准。',
    shareCategory: 'landscape',
  },
  {
    id: 'prop',
    label: '道具',
    en: 'PROP',
    icon: 'bi-hammer',
    placeholder: '描述道具：类型 / 材质 / 稀有度 / 结构与工艺细节…',
    defaultPrompt: '一把镶嵌蓝色能量核心的单手圣剑，剑柄缠绕鎏金藤纹，传说级稀有度',
    examples: [
      { label: '远古卷轴', text: '泛黄的远古魔法卷轴，火漆封印，边缘符文微微发光' },
      { label: '生命药水', text: '玻璃瓶装的鲜红生命药水，软木塞，瓶身有气泡与高光' },
      { label: '秘银宝箱', text: '秘银包角的橡木宝箱，锁扣精致，箱缝透出金光' },
    ],
    aspects: ['1:1', '4:3'],
    defaultAspect: '1:1',
    controlGroups: [
      { id: 'presentation', label: '展示与规格', output: true },
      { id: 'design', label: '品类与造型' },
      { id: 'surface', label: '材质与状态' },
      { id: 'production', label: '资产拆解' },
    ],
    selects: [
      {
        key: 'layout',
        group: 'presentation',
        label: '展示方式',
        options: [
          { id: 'single', label: '单件展示', prompt: '单件道具居中完整展示' },
          { id: 'sheet', label: '多角度图鉴', prompt: '同一道具的多角度视图排列成设定图鉴' },
          {
            id: 'set',
            label: '同系列一组',
            prompt: '同一风格系列的一组道具整齐排列，风格严格统一',
          },
        ],
      },
      {
        key: 'category',
        group: 'design',
        label: '道具品类',
        options: [
          { id: 'auto', label: '匹配描述', prompt: '' },
          { id: 'weapon', label: '武器', prompt: '武器类道具，握持、攻击方式与受力结构可信' },
          {
            id: 'armor',
            label: '护甲配件',
            prompt: '护甲或穿戴配件，人体连接、活动范围与防护逻辑明确',
          },
          {
            id: 'consumable',
            label: '消耗品',
            prompt: '药剂、食物或消耗品，容量、封装与使用方式一眼可读',
          },
          {
            id: 'container',
            label: '容器机关',
            prompt: '宝箱、容器或机关，开启结构、锁具与交互部位清晰',
          },
          { id: 'quest', label: '任务物品', prompt: '关键任务物品，拥有唯一识别点与明确叙事线索' },
        ],
      },
      {
        key: 'rarity',
        group: 'design',
        label: '稀有度',
        options: [
          { id: 'common', label: '普通', prompt: '普通品质，结构实用，装饰克制，制造工艺可信' },
          { id: 'rare', label: '稀有', prompt: '稀有品质，增加独特材质、色彩焦点与精细工艺' },
          { id: 'epic', label: '史诗', prompt: '史诗品质，轮廓华丽，核心能量或身份符号突出' },
          {
            id: 'legendary',
            label: '传说',
            prompt: '传说品质，拥有唯一神话叙事、标志轮廓和顶级工艺层次',
          },
        ],
      },
      {
        key: 'shapeLanguage',
        group: 'design',
        label: '形状语言',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'round', label: '圆润友好', prompt: '圆润柔和形状语言，安全、亲和且握持舒适' },
          { id: 'angular', label: '锐利攻击', prompt: '锐利有方向性的形状语言，动势与攻击性明确' },
          { id: 'blocky', label: '厚重工业', prompt: '方正厚重形状语言，承重、耐久和机械结构突出' },
          {
            id: 'organic',
            label: '有机生长',
            prompt: '有机生长形状语言，结构连续且符合生物或植物逻辑',
          },
        ],
      },
      {
        key: 'material',
        group: 'surface',
        label: '主材质',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          {
            id: 'metal',
            label: '金属',
            prompt: '金属主材质，厚度、粗糙度、边缘高光与连接工艺可信',
          },
          {
            id: 'wood-leather',
            label: '木材皮革',
            prompt: '木材与皮革组合，纹理方向、缝合与磨损位置合理',
          },
          {
            id: 'glass-crystal',
            label: '玻璃晶体',
            prompt: '玻璃或晶体材质，折射、内部结构与边缘高光清晰受控',
          },
          {
            id: 'organic',
            label: '骨质生物',
            prompt: '骨质、甲壳或生物材质，生长结构与功能部位自洽',
          },
          {
            id: 'tech',
            label: '科技复合',
            prompt: '科技复合材料，装甲、能源、接口与功能分件关系明确',
          },
        ],
      },
      {
        key: 'condition',
        group: 'surface',
        label: '使用状态',
        options: [
          { id: 'pristine', label: '崭新', prompt: '崭新洁净状态，制造边缘清晰，避免廉价塑料感' },
          { id: 'used', label: '常用', prompt: '真实日常使用痕迹集中在握持、碰撞和活动区域' },
          {
            id: 'damaged',
            label: '战损',
            prompt: '可读的战损、刮痕与维修痕迹，不破坏核心功能结构',
          },
          {
            id: 'ancient',
            label: '古旧',
            prompt: '长期年代痕迹、氧化与沉积，重要纹章和材质仍可辨识',
          },
        ],
      },
      {
        key: 'construction',
        group: 'production',
        label: '结构复杂度',
        options: [
          {
            id: 'simple',
            label: '简洁量产',
            prompt: '简洁量产结构，部件数量可控，适合常规游戏资产制作',
          },
          {
            id: 'balanced',
            label: '生产均衡',
            prompt: '中等结构复杂度，主次分件明确，兼顾表现与制作成本',
          },
          {
            id: 'complex',
            label: '复杂机关',
            prompt: '复杂机关结构，活动件、连接件与动力路径均有明确功能',
          },
        ],
      },
    ],
    toggles: [
      {
        key: 'transparent',
        group: 'presentation',
        label: '透明背景',
        icon: 'bi-transparency',
        prompt: '纯净透明背景，主体边缘干净',
      },
      {
        key: 'orthographic',
        group: 'production',
        label: '正交设定',
        icon: 'bi-bounding-box',
        prompt: '使用正交设定视角，避免透视夸张，比例与结构便于建模读取',
      },
      {
        key: 'explodedParts',
        group: 'production',
        label: '拆件展示',
        icon: 'bi-boxes',
        prompt: '主要部件以可拆分方式清晰展示，连接点和装配顺序明确',
      },
    ],
    line: '游戏道具设计，材质与工艺细节可辨识，稀有度气质匹配，可直接进入资产管线。',
    shareCategory: 'other',
  },
  {
    id: 'ui',
    label: '游戏 UI',
    en: 'GAME UI',
    icon: 'bi-window-stack',
    placeholder: '描述界面：游戏类型 / 信息内容 / 控件 / 世界观氛围…',
    defaultPrompt: '东方仙侠 MMORPG 的界面，水墨与鎏金装饰边框，半透明面板，界面文案使用简洁中文',
    examples: [
      {
        label: '科幻 HUD',
        text: '硬科幻太空射击游戏的战斗界面，全息投影质感，青色描边，信息密度高',
      },
      { label: '休闲主菜单', text: '休闲消除手游主菜单，奶油色圆角卡片，大按钮，活泼气泡装饰' },
      { label: '暗黑背包', text: '暗黑风 ARPG 背包界面，铁艺格子，羊皮纸属性面板，血红强调色' },
    ],
    aspects: ['16:9', '9:16', '4:3'],
    defaultAspect: '16:9',
    controlGroups: [
      { id: 'screen', label: '界面与平台', output: true },
      { id: 'information', label: '信息与布局' },
      { id: 'visual', label: '视觉系统' },
      { id: 'delivery', label: '状态与交付' },
    ],
    selects: [
      {
        key: 'screen',
        group: 'screen',
        label: '界面类型',
        options: [
          {
            id: 'hud',
            label: '战斗 HUD',
            prompt: '战斗 HUD 界面：血条、技能栏、小地图、任务追踪等控件布局完整',
          },
          {
            id: 'menu',
            label: '主菜单',
            prompt: '主菜单界面：游戏标题、开始/继续/设置入口、主视觉背景',
          },
          {
            id: 'inventory',
            label: '背包库存',
            prompt: '背包/库存界面：物品格子系统、装备栏、角色属性面板',
          },
          {
            id: 'shop',
            label: '商店',
            prompt: '游戏内商店界面：商品卡片、货币栏、购买按钮、限时促销位',
          },
          {
            id: 'result',
            label: '结算弹窗',
            prompt: '战斗结算弹窗：评级星级、奖励列表、经验条、按钮组',
          },
        ],
      },
      {
        key: 'platform',
        group: 'screen',
        label: '目标平台',
        options: [
          {
            id: 'desktop',
            label: 'PC/主机',
            prompt: '面向 PC 或主机平台，信息密度和操作距离适合大屏幕',
          },
          { id: 'tablet', label: '平板', prompt: '面向平板横屏或竖屏，兼顾触控效率与较高信息密度' },
          {
            id: 'cross',
            label: '跨平台',
            prompt: '跨平台布局体系，核心信息和组件可以适配不同屏幕比例',
          },
        ],
      },
      {
        key: 'density',
        group: 'information',
        label: '信息密度',
        options: [
          {
            id: 'low',
            label: '低密度',
            prompt: '低信息密度，大控件与清晰留白，适合休闲和移动端体验',
          },
          { id: 'balanced', label: '均衡', prompt: '均衡信息密度，主次层级明确，常用操作一眼可见' },
          {
            id: 'high',
            label: '高密度',
            prompt: '高信息密度但分区有序，适合策略、模拟或复杂 RPG 系统',
          },
        ],
      },
      {
        key: 'layoutSystem',
        group: 'information',
        label: '布局系统',
        options: [
          { id: 'grid', label: '栅格面板', prompt: '严格栅格化面板布局，对齐、间距与分区规律统一' },
          {
            id: 'radial',
            label: '环形操作',
            prompt: '环形或轮盘式操作布局，选项距离一致，焦点状态清晰',
          },
          {
            id: 'modular',
            label: '模块卡片',
            prompt: '模块化卡片和面板布局，信息块可以独立组合与复用',
          },
          {
            id: 'immersive',
            label: '沉浸 HUD',
            prompt: '沉浸式 HUD 布局，信息贴合游戏空间但保持可读性',
          },
        ],
      },
      {
        key: 'navigation',
        group: 'information',
        label: '导航结构',
        options: [
          { id: 'tabs', label: '标签导航', prompt: '标签式导航结构，当前层级和切换入口明确' },
          {
            id: 'sidebar',
            label: '侧栏导航',
            prompt: '侧边栏导航结构，一级功能稳定，内容区层级清晰',
          },
          {
            id: 'bottom',
            label: '底部导航',
            prompt: '底部主导航结构，适合移动端拇指操作和高频切换',
          },
          {
            id: 'contextual',
            label: '情境导航',
            prompt: '根据当前游戏情境显示操作，减少无关信息干扰',
          },
        ],
      },
      {
        key: 'visualLanguage',
        group: 'visual',
        label: '组件语言',
        options: [
          {
            id: 'minimal',
            label: '现代简洁',
            prompt: '现代简洁组件语言，边界克制，层级依靠间距、字号和明度',
          },
          {
            id: 'ornate',
            label: '世界观装饰',
            prompt: '世界观装饰型组件语言，纹样和边框服务于功能层级',
          },
          {
            id: 'industrial',
            label: '工业硬朗',
            prompt: '工业硬朗组件语言，结构线、状态灯和功能分区明确',
          },
          {
            id: 'organic',
            label: '自然有机',
            prompt: '自然有机组件语言，柔和形状与材质纹理保持可读性',
          },
        ],
      },
      {
        key: 'contrast',
        group: 'visual',
        label: '视觉对比',
        options: [
          {
            id: 'accessible',
            label: '高可读',
            prompt: '文字、图标和背景保持高可读对比，关键状态不只依赖颜色',
          },
          { id: 'soft', label: '柔和层次', prompt: '柔和明度层次，通过面板深浅和留白区分信息' },
          {
            id: 'dramatic',
            label: '强氛围',
            prompt: '强氛围视觉，但交互控件和关键数据始终清晰可辨',
          },
        ],
      },
      {
        key: 'interactionState',
        group: 'delivery',
        label: '展示状态',
        options: [
          {
            id: 'default',
            label: '默认态',
            prompt: '展示完整默认状态，信息和操作均处于正常可用状态',
          },
          { id: 'selected', label: '选中态', prompt: '同时展示清晰的选中、聚焦和当前项状态' },
          {
            id: 'combat',
            label: '动态战斗态',
            prompt: '展示战斗或高压情境状态，告警和冷却信息层级明确',
          },
          { id: 'empty', label: '空状态', prompt: '展示设计完整的空状态，保留下一步主要操作入口' },
        ],
      },
    ],
    toggles: [
      {
        key: 'safeArea',
        group: 'delivery',
        label: '安全区适配',
        icon: 'bi-aspect-ratio',
        prompt: '重要信息避开屏幕边缘、刘海和主机安全区，布局留有适配余量',
      },
      {
        key: 'componentSheet',
        group: 'delivery',
        label: '组件规范',
        icon: 'bi-ui-checks-grid',
        prompt: '组件尺寸、圆角、描边、间距和状态样式保持统一设计系统',
      },
      {
        key: 'noMockup',
        group: 'delivery',
        label: '纯界面稿',
        icon: 'bi-window',
        prompt: '只输出正视完整界面稿，不放入手机、显示器或透视样机',
      },
    ],
    line: '完整游戏界面设计稿，控件层级与信息架构清晰，组件风格统一，可直接指导 UI 制作与切图。',
    shareCategory: 'other',
  },
  {
    id: 'icon',
    label: '图标',
    en: 'ICON',
    icon: 'bi-gem',
    placeholder: '描述图标：主题元素 / 颜色倾向 / 品质气质…',
    defaultPrompt: '一枚燃烧的火焰剑刃技能图标，橙红渐变能量，深色底座衬托',
    examples: [
      { label: '冰霜法术', text: '冰霜新星法术图标，六角冰晶绽放，青蓝通透质感' },
      { label: '金币货币', text: '游戏金币货币图标，立体堆叠，边缘高光，饱满金黄' },
      { label: '王者徽章', text: '王者段位成就徽章，翼形装饰环绕盾牌，紫金配色' },
    ],
    aspects: ['1:1'],
    defaultAspect: '1:1',
    controlGroups: [
      { id: 'content', label: '内容与排列', output: true },
      { id: 'shape', label: '轮廓与机位' },
      { id: 'render', label: '配色与渲染' },
      { id: 'production', label: '系列制作' },
    ],
    selects: [
      {
        key: 'kind',
        group: 'content',
        label: '图标类型',
        options: [
          { id: 'skill', label: '技能图标', prompt: '技能图标，能量与动势表现强' },
          { id: 'item', label: '物品图标', prompt: '物品图标，实体感与材质细节清晰' },
          { id: 'currency', label: '货币/宝石', prompt: '货币与宝石图标，质感通透饱满' },
          { id: 'badge', label: '成就徽章', prompt: '成就徽章图标，构图对称，仪式感强' },
        ],
      },
      {
        key: 'layout',
        group: 'content',
        label: '排列',
        options: [
          { id: 'single', label: '单个大图', prompt: '单个图标居中展示' },
          {
            id: 'grid',
            label: '3x3 图标集',
            prompt: '同一风格的 9 个不同图标排成 3x3 网格，风格与光源严格统一',
          },
        ],
      },
      {
        key: 'silhouette',
        group: 'shape',
        label: '剪影复杂度',
        options: [
          { id: 'bold', label: '强剪影', prompt: '强烈简洁剪影，小尺寸下主体类别仍可立即识别' },
          { id: 'balanced', label: '均衡', prompt: '均衡剪影与内部细节，焦点明确且边缘干净' },
          { id: 'ornate', label: '华丽', prompt: '华丽轮廓和装饰细节，但不产生碎边与视觉噪声' },
        ],
      },
      {
        key: 'camera',
        group: 'shape',
        label: '物体机位',
        options: [
          { id: 'front', label: '正视', prompt: '正视或近正视机位，轮廓对称稳定，信息读取直接' },
          {
            id: 'three-quarter',
            label: '3/4 立体',
            prompt: '三分之四立体机位，体积、厚度与正面特征同时清晰',
          },
          { id: 'isometric', label: '等距', prompt: '统一等距机位，适合背包物品和建造类图标系列' },
          { id: 'dynamic', label: '动态斜角', prompt: '具有方向性的动态斜角机位，强化技能冲击力' },
        ],
      },
      {
        key: 'palette',
        group: 'render',
        label: '配色策略',
        options: [
          {
            id: 'category',
            label: '类别色',
            prompt: '使用明确类别色区分功能，主体色与背景色对比清楚',
          },
          { id: 'rarity', label: '品质色', prompt: '按品质等级组织颜色和光效，稀有度差异一眼可见' },
          { id: 'elemental', label: '元素色', prompt: '按火、水、冰、雷等元素建立稳定配色语义' },
          {
            id: 'limited',
            label: '限制色盘',
            prompt: '使用克制限制色盘，保持系列统一与小尺寸清晰度',
          },
        ],
      },
      {
        key: 'renderStyle',
        group: 'render',
        label: '渲染方式',
        options: [
          { id: 'painted', label: '厚涂', prompt: '精致游戏厚涂渲染，体积、材质与边缘控制清楚' },
          { id: '3d', label: '3D 质感', prompt: '统一 3D 图标渲染，材质细腻，灯光方向严格一致' },
          { id: 'flat', label: '扁平矢量', prompt: '扁平化图形渲染，色块干净，描边与圆角规则统一' },
          { id: 'pixel', label: '像素图标', prompt: '像素图标渲染，像素网格清楚，边缘无插值模糊' },
        ],
      },
      {
        key: 'frame',
        group: 'production',
        label: '边框底座',
        options: [
          { id: 'none', label: '无边框', prompt: '无装饰边框，主体轮廓独立完整，适合透明底输出' },
          { id: 'simple', label: '简洁底座', prompt: '简洁统一底座或暗色衬底，不抢夺主体焦点' },
          { id: 'rarity', label: '品质边框', prompt: '品质边框结构统一，颜色与装饰密度体现稀有度' },
          { id: 'ornate', label: '主题边框', prompt: '世界观主题边框，四角和轮廓装饰保持系列一致' },
        ],
      },
    ],
    toggles: [
      {
        key: 'transparent',
        group: 'content',
        label: '透明背景',
        icon: 'bi-transparency',
        prompt: '纯净透明背景，主体边缘干净',
      },
      {
        key: 'unifiedLighting',
        group: 'production',
        label: '统一光源',
        icon: 'bi-sun',
        prompt: '系列图标使用完全一致的主光方向、阴影软硬和高光强度',
      },
      {
        key: 'smallSizeSafe',
        group: 'production',
        label: '小尺寸可读',
        icon: 'bi-bounding-box-circles',
        prompt: '在 64px 和 32px 尺寸下仍保持核心剪影与焦点清楚',
      },
    ],
    line: '游戏图标设计，小尺寸缩放后剪影依旧清晰可读，边缘干净，统一光源方向。',
    shareCategory: 'other',
  },
  {
    id: 'texture',
    label: '贴图',
    en: 'TEXTURE',
    icon: 'bi-grid-3x3',
    placeholder: '描述贴图：材质 / 风化程度 / 颜色 / 时代感…',
    defaultPrompt: '中世纪城堡的灰色石砖墙面，砖缝深邃，边缘轻微风化，苔藓点缀',
    examples: [
      { label: '古旧木纹', text: '饱经风霜的深色橡木板，木纹清晰，有钉孔与划痕' },
      { label: '科幻面板', text: '科幻飞船外壳金属面板，拼接线与铆钉，哑光灰蓝' },
      { label: '草地地表', text: '茂密草地地表，混有小石子与蒲公英，俯视视角' },
    ],
    aspects: ['1:1'],
    defaultAspect: '1:1',
    controlGroups: [
      { id: 'material', label: '材质与规格', output: true },
      { id: 'surface', label: '表面与尺度' },
      { id: 'capture', label: '采集与光照' },
      { id: 'production', label: '平铺制作' },
    ],
    selects: [
      {
        key: 'material',
        group: 'material',
        label: '材质类型',
        options: [
          { id: 'stone', label: '石材', prompt: '石材质感，颗粒与裂纹自然' },
          { id: 'wood', label: '木纹', prompt: '木质纹理，年轮与纤维方向一致' },
          { id: 'metal', label: '金属', prompt: '金属质感，反射与磨损合理' },
          { id: 'fabric', label: '布料', prompt: '布料编织纹理，经纬清晰' },
          { id: 'ground', label: '地表', prompt: '自然地表材质，元素分布均匀不重复' },
          { id: 'scifi', label: '科幻', prompt: '科幻硬面板材，拼缝与功能细节合理' },
        ],
      },
      {
        key: 'surfaceCondition',
        group: 'surface',
        label: '表面状态',
        options: [
          { id: 'clean', label: '干净', prompt: '干净均匀表面，保留自然微观变化，避免人工污渍' },
          { id: 'used', label: '轻度使用', prompt: '轻度真实使用痕迹，磨损分布符合接触与受力规律' },
          { id: 'weathered', label: '风化', prompt: '明显风化、褪色与边缘损耗，主材质结构仍清晰' },
          { id: 'damaged', label: '破损', prompt: '裂纹、缺口和修补痕迹自然分布，不形成重复图案' },
          {
            id: 'overgrown',
            label: '植被附着',
            prompt: '苔藓、藤蔓或微小植被附着，生长位置受湿度和缝隙影响',
          },
        ],
      },
      {
        key: 'texelScale',
        group: 'surface',
        label: '纹理尺度',
        options: [
          { id: 'macro', label: '大尺度', prompt: '大尺度纹理块面，适合远景地形和大型建筑表面' },
          {
            id: 'medium',
            label: '中尺度',
            prompt: '中等纹理尺度，主纹理、次级变化和微细节层级均衡',
          },
          { id: 'micro', label: '微细节', prompt: '高密度微观纹理，适合近景资产表面，避免噪点化' },
        ],
      },
      {
        key: 'pattern',
        group: 'surface',
        label: '图案组织',
        options: [
          { id: 'random', label: '自然随机', prompt: '自然随机分布，无明显重复簇和方向性接缝' },
          {
            id: 'directional',
            label: '方向纹理',
            prompt: '方向性纹理保持统一流向，边缘衔接时方向连续',
          },
          { id: 'geometric', label: '几何规则', prompt: '规则几何图案，间距、比例和对齐精确一致' },
          {
            id: 'layered',
            label: '分层混合',
            prompt: '底材、覆盖层和局部变化分层清晰，混合边界自然',
          },
        ],
      },
      {
        key: 'captureMode',
        group: 'capture',
        label: '呈现通道',
        options: [
          {
            id: 'albedo',
            label: '基础色',
            prompt: '接近 PBR Base Color 的纯基础色贴图，无烘焙光照、阴影和高光',
          },
          {
            id: 'material-preview',
            label: '材质预览',
            prompt: '中性材质球级预览质感，粗糙度与凹凸关系清楚但光照均匀',
          },
          {
            id: 'stylized',
            label: '风格化色稿',
            prompt: '风格化手绘贴图，明暗变化服务形体但不含方向性场景投影',
          },
          {
            id: 'mask-ready',
            label: '遮罩友好',
            prompt: '颜色区域分离清楚，便于后续提取材质遮罩和调色',
          },
        ],
      },
      {
        key: 'roughness',
        group: 'capture',
        label: '粗糙度倾向',
        options: [
          { id: 'matte', label: '哑光', prompt: '整体哑光粗糙表面，色彩稳定，无尖锐高光热点' },
          { id: 'balanced', label: '均衡', prompt: '粗糙与光滑区域分布符合材质结构，层次清晰' },
          {
            id: 'glossy',
            label: '光滑',
            prompt: '光滑表面特征明确，但输出不烘焙固定高光和环境反射',
          },
        ],
      },
      {
        key: 'variation',
        group: 'production',
        label: '色彩变化',
        options: [
          { id: 'subtle', label: '轻微', prompt: '轻微低频色彩变化，整体色相稳定且无大块脏污' },
          {
            id: 'balanced',
            label: '均衡',
            prompt: '低频、中频和高频色彩变化比例均衡，避免视觉噪声',
          },
          {
            id: 'rich',
            label: '丰富',
            prompt: '丰富自然色彩变化，但四边衔接和整体材质身份保持稳定',
          },
        ],
      },
    ],
    toggles: [
      {
        key: 'seamless',
        group: 'production',
        label: '无缝平铺',
        icon: 'bi-grid-3x3',
        prompt: '无缝可平铺贴图（seamless tileable），四边完全衔接，无明显重复感',
      },
      {
        key: 'flatLighting',
        group: 'capture',
        label: '去除烘焙光影',
        icon: 'bi-brightness-high',
        prompt: '去除方向性光照、环境阴影、高光热点和暗角，只保留材质本身颜色信息',
      },
      {
        key: 'orthographic',
        group: 'production',
        label: '正交无透视',
        icon: 'bi-bounding-box',
        prompt: '严格正交俯视采集，无透视收缩、景深、镜头畸变或边缘变形',
      },
    ],
    line: '游戏贴图素材，均匀漫反射照明，无高光热点、无阴影投射、无景深、无透视畸变。',
    shareCategory: 'other',
  },
]

export const STYLE_OPTIONS = [
  {
    id: 'stylized-3d',
    label: '风格化 3D',
    prompt: '风格化 3D 渲染，形体夸张有度，颜色饱满',
    swatch: 'radial-gradient(90% 120% at 30% 20%, #ffb54d 0%, #ff7847 34%, #ff3b9d 100%)',
  },
  {
    id: 'anime',
    label: '动漫赛璐璐',
    prompt: '动漫赛璐璐上色，干净色块与利落描边',
    swatch: 'linear-gradient(135deg, #ff9ecf 0 38%, #ffd7e8 38% 62%, #7cc7ff 62% 100%)',
  },
  {
    id: 'realistic',
    label: '写实次世代',
    prompt: '写实次世代品质，物理正确的材质与光照',
    swatch: 'linear-gradient(160deg, #d8dee5 0%, #6f7d8c 42%, #232c36 100%)',
  },
  {
    id: 'pixel-art',
    label: '像素美术',
    prompt: '精细像素美术，色板克制，像素对齐',
    swatch: 'repeating-conic-gradient(#57e3a2 0% 25%, #275d8c 0% 50%) 0 0 / 12px 12px',
  },
  {
    id: 'hand-painted',
    label: '手绘厚涂',
    prompt: '手绘厚涂质感，笔触可见，暖色光影',
    swatch: 'radial-gradient(120% 150% at 70% 30%, #f7d9a8 0%, #c98a5b 46%, #5c3a2e 100%)',
  },
  {
    id: 'concept-art',
    label: '概念设定稿',
    prompt: '专业游戏概念设定稿风格，设计意图明确，结构、材质与功能注重生产可读性',
    swatch: 'linear-gradient(145deg, #d8d2c2 0%, #777d82 52%, #24282c 100%)',
  },
  {
    id: 'fantasy-illustration',
    label: '奇幻插画',
    prompt: '高完成度奇幻游戏插画，叙事光影、细腻材质与史诗氛围平衡统一',
    swatch: 'linear-gradient(145deg, #3c2a66 0%, #9b547d 48%, #e4ad62 100%)',
  },
  {
    id: 'comic-ink',
    label: '美漫墨线',
    prompt: '美式漫画墨线与块面上色，线条有力量，明暗分组清楚，轮廓具有冲击力',
    swatch: 'linear-gradient(135deg, #f0d454 0 32%, #15181b 32% 58%, #d94747 58% 100%)',
  },
  {
    id: 'ink-wash',
    label: '东方水墨',
    prompt: '现代东方水墨游戏美术，墨色层次克制，留白明确，轮廓与关键结构清楚',
    swatch: 'radial-gradient(circle at 35% 35%, #e8e5dc 0%, #92948f 38%, #252829 100%)',
  },
  {
    id: 'low-poly',
    label: '低多边形',
    prompt: '低多边形游戏美术，几何切面干净，色块组织清楚，形体在低面数下依然可读',
    swatch: 'conic-gradient(from 30deg, #65c1a6, #39758f, #a6d36c, #65c1a6)',
  },
  {
    id: 'retro-psx',
    label: '复古 PSX',
    prompt: '复古 PSX 时代 3D 游戏风格，低面数模型、受控像素纹理与硬朗光照，保持主体清晰',
    swatch: 'repeating-linear-gradient(135deg, #553b7a 0 8px, #2e6672 8px 16px, #c4795b 16px 24px)',
  },
  {
    id: 'watercolor',
    label: '水彩绘本',
    prompt: '精致水彩绘本风格，透明叠色、自然纸张肌理与清楚主体边缘平衡呈现',
    swatch: 'radial-gradient(circle at 25% 25%, #e6a8b5 0%, #83b5c8 48%, #d8cf8d 100%)',
  },
]

export const DEFAULT_POSITIVE =
  '主体完整呈现且关键部位不裁切，形体结构与部件连接关系清晰可信，设计可直接指导游戏资产制作'

export const DEFAULT_NEGATIVE = '模糊，低清晰度，错误肢体，文字，水印，照片样机，裁切主体'

export const POSITIVE_CONSTRAINT_PRESETS = [
  { label: '主体完整', value: '主体完整呈现且关键部位不裁切' },
  { label: '构图稳定', value: '构图重心稳定且视觉焦点唯一明确' },
  { label: '结构清晰', value: '形体结构与部件连接关系清晰可信' },
  { label: '轮廓可读', value: '主体剪影在缩小后仍清晰可识别' },
  { label: '材质分层', value: '不同材质的颜色粗糙度与厚度层次明确' },
  { label: '统一光源', value: '主光方向统一且暗部保留结构细节' },
  { label: '生产可用', value: '设计可直接指导游戏建模切图与资产制作' },
  { label: '系列一致', value: '比例配色细节密度与视觉语言保持系列一致' },
]

export const NEGATIVE_CONSTRAINT_PRESETS = [
  { label: '结构错误', value: '错误解剖与不合理结构连接' },
  { label: '多余部件', value: '多余肢体多余部件与重复元素' },
  { label: '裁切遮挡', value: '主体裁切关键部位遮挡与边缘出框' },
  { label: '重复主体', value: '重复人物重复道具与幽灵重影' },
  { label: '文字水印', value: '乱码文字水印签名与品牌标志' },
  { label: '样机包装', value: '手机显示器包装盒与透视样机场景' },
  { label: '背景杂乱', value: '无关背景元素与抢夺焦点的装饰' },
  { label: '光影失控', value: '过曝高光死黑暗部与多重冲突光源' },
  { label: '噪点伪影', value: '噪点压缩伪影脏纹理与过度锐化' },
  { label: '透视畸变', value: '错误透视镜头拉伸与比例畸变' },
]

export const CLARITY_OPTIONS = [
  {
    id: 'clear',
    label: '清晰',
    prompt: '高清晰度输出，主体边缘明确，纹理层次干净，避免柔焦与无意义锐化',
  },
  {
    id: 'ultra',
    label: '超清',
    prompt:
      '超高清晰度输出，100% 放大查看时轮廓、面部、材质纹理与细小结构仍然清楚，使用受控锐化，不产生白边光晕',
  },
  {
    id: 'faithful',
    label: '保真',
    prompt:
      '高保真清晰度输出，准确还原原始形体、身份、色彩边界和真实纹理，只恢复可信细节，不凭空添加伪纹理',
  },
]

export const REFERENCE_CONSTRAINT_OPTIONS = [
  {
    id: 'balanced',
    label: '平衡还原',
    prompt: '保留参考图主体身份、核心轮廓、关键配色和设计特征，同时允许生产级优化',
  },
  {
    id: 'strict',
    label: '严格还原',
    prompt: '严格保持参考图主体身份、比例、轮廓、材质、服装或结构和配色，不重新设计',
  },
  {
    id: 'identity',
    label: '锁定主体',
    prompt: '锁定参考图主体身份和核心结构，允许调整姿态、环境、装饰与呈现方式',
  },
  {
    id: 'inspiration',
    label: '仅作灵感',
    prompt: '只提取参考图的视觉气质、材质倾向与设计语言，不复制具体造型和构图',
  },
]
