<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { gsap } from 'gsap'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import WallevenImagePreview from '@/components/common/WallevenImagePreview.vue'
import InsufficientCreditsDialog from '@/features/ai-shared/InsufficientCreditsDialog.vue'
import SharePublishDialog from '@/features/share/components/SharePublishDialog.vue'
import { withTransparentPngInstruction } from '@/features/ai-shared/transparentPng'
import { readImageFile } from '@/features/design-workshop/imageWorkshop'
import { useCanvasDeck } from '@/features/creative-studios/useCanvasDeck'
import { useCreativeImageJob } from '@/features/creative-studios/useCreativeImageJob'
import { useStudioMotion } from '@/features/creative-studios/useStudioMotion'
import { downloadAuthenticatedMedia } from '@/services/authenticatedMedia'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { listMyShareAssets, submitShareItem } from '@/services/shareGallery'
import { listPromptLibrary, recordPromptEngagement } from '@/services/promptLibrary'
import notificationService from '@/services/notification'

const SETTINGS_KEY = 'game-art-studio-v1'

const ASSET_TYPES = [
  {
    id: 'character',
    label: '角色',
    en: 'CHARACTER',
    icon: 'bi-person-bounding-box',
    placeholder: '描述角色：种族 / 职业 / 服装结构 / 配色 / 武器道具 / 气质…',
    defaultPrompt: '一名在浮空遗迹中探索的星轨机械师，服装结构清晰，装备可拆分，造型具有强记忆点',
    examples: [
      { label: '暗夜刺客', text: '身披暗紫斗篷的精灵刺客，双持短刃，轻甲与皮革混搭，冷色调，剪影凌厉' },
      { label: 'Q 版法师', text: '圆润可爱的 Q 版小法师，超大帽子遮住半张脸，发光法杖，明快糖果色' },
      { label: '重装骑士', text: '全身板甲的圣殿骑士，鎏金纹章，巨剑拄地，庄重史诗感' },
    ],
    aspects: ['3:4', '1:1', '9:16'],
    defaultAspect: '3:4',
    controlGroups: [
      { id: 'composition', label: '构图与镜头', output: true },
      { id: 'identity', label: '角色塑造' },
      { id: 'face', label: '面部与发型' },
      { id: 'performance', label: '动作与表演' },
      { id: 'wardrobe', label: '服装与装备' },
      { id: 'surface', label: '材质与状态' },
      { id: 'narrative', label: '阵营与特效' },
      { id: 'lighting', label: '灯光与色彩' },
      { id: 'production', label: '生产约束' },
      { id: 'reference', label: '参考图约束' },
    ],
    selects: [
      {
        key: 'framing',
        group: 'composition',
        label: '画面用途',
        options: [
          { id: 'full-body', label: '全身立绘', prompt: '完整全身立绘，主体居中无裁切，脚部完整' },
          { id: 'turnaround', label: '三视图', prompt: '同一角色的正面、侧面、背面三视图并排，比例严格一致' },
          { id: 'bust', label: '半身特写', prompt: '半身像特写，突出面部神态与上身服装细节' },
          { id: 'splash', label: '宣传立绘', prompt: '游戏宣传级角色立绘，构图具有叙事张力和强视觉焦点' },
        ],
      },
      {
        key: 'camera',
        group: 'composition',
        label: '镜头机位',
        options: [
          { id: 'auto', label: '智能机位', prompt: '' },
          { id: 'three-quarter', label: '经典 3/4', prompt: '经典三分之四视角，面部与身体结构同时清晰可见' },
          { id: 'eye-level', label: '平视', prompt: '平视机位，角色比例自然稳定' },
          { id: 'low-angle', label: '低机位', prompt: '轻微低机位仰拍，强化角色力量感与英雄气质' },
          { id: 'high-angle', label: '高机位', prompt: '轻微高机位俯拍，强化角色轮廓和叙事氛围' },
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
          { id: 'villain', label: '反派', prompt: '主要反派定位，危险感与压迫感明确，动机气质可信' },
          { id: 'boss', label: '首领', prompt: 'Boss 首领定位，体量感强，拥有阶段性战斗设计线索' },
          { id: 'npc', label: 'NPC', prompt: '功能型 NPC 定位，职业和阵营信息一眼可读' },
        ],
      },
      {
        key: 'subjectForm',
        group: 'identity',
        label: '角色形态',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'humanoid', label: '人形', prompt: '人形或类人形角色，人体结构、关节与穿戴关系可信' },
          { id: 'creature', label: '生物', prompt: '非人类生物角色，解剖结构、运动方式与生态特征自洽' },
          { id: 'mechanical', label: '机械', prompt: '机械角色，关节、动力核心、装甲分件与功能结构合理' },
          { id: 'spirit', label: '灵体', prompt: '能量或灵体角色，实体轮廓可读，透明与发光层次受控' },
        ],
      },
      {
        key: 'age',
        group: 'identity',
        label: '视觉年龄',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'young', label: '青年', prompt: '青年角色的面部与身体年龄特征' },
          { id: 'adult', label: '成年', prompt: '成熟成年角色的面部与身体年龄特征' },
          { id: 'mature', label: '中年', prompt: '阅历丰富的中年角色特征，适度年龄纹理' },
          { id: 'elder', label: '长者', prompt: '高龄长者特征，年龄结构真实且保持角色魅力' },
        ],
      },
      {
        key: 'build',
        group: 'identity',
        label: '体型轮廓',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'balanced', label: '匀称', prompt: '匀称可信的身体比例，轮廓均衡' },
          { id: 'agile', label: '敏捷', prompt: '修长敏捷体型，动作轻盈，轮廓锐利' },
          { id: 'powerful', label: '强壮', prompt: '强壮有力体型，肌肉结构与装备承重合理' },
          { id: 'heavy', label: '厚重', prompt: '厚重高体量轮廓，稳定感与压迫感强' },
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
          { id: 'stylized', label: '风格化', prompt: '风格化面部比例，五官夸张但身份稳定且不崩坏' },
        ],
      },
      {
        key: 'hairDesign',
        group: 'face',
        label: '发型轮廓',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'short', label: '短发', prompt: '短发大形清晰，发束方向服从头部结构' },
          { id: 'long', label: '长发', prompt: '长发轮廓具有流动感，发丝层级清晰且不遮挡主体结构' },
          { id: 'tied', label: '束发', prompt: '束发或编发结构，固定方式和发饰逻辑清楚' },
          { id: 'covered', label: '头盔/兜帽', prompt: '头盔或兜帽作为主要头部轮廓，结构与服装设计统一' },
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
          { id: 'marking', label: '纹身/印记', prompt: '加入阵营纹身或能量印记，图形设计与世界观统一' },
          { id: 'makeup', label: '妆容', prompt: '具有角色身份感的妆容，色彩与服装主色呼应' },
        ],
      },
      {
        key: 'stance',
        group: 'performance',
        label: '身体姿态',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'ready', label: '准备姿态', prompt: '自然准备姿态，重心明确，双手和装备无遮挡' },
          { id: 'neutral', label: '中性站姿', prompt: '中性稳定站姿，便于完整读取服装与身体结构' },
          { id: 'combat', label: '战斗动作', prompt: '战斗动态姿势，动作张力强，剪影依然清晰可读' },
          { id: 'casting', label: '施法动作', prompt: '施法动作，手势和能量流向明确，特效不遮挡主体' },
          { id: 'movement', label: '运动瞬间', prompt: '奔跑或跃动中的关键帧姿态，动态方向清晰' },
        ],
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
        ],
      },
      {
        key: 'costume',
        group: 'wardrobe',
        label: '服装结构',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'layered', label: '多层服装', prompt: '内中外多层服装结构，穿着逻辑和层级关系清晰' },
          { id: 'light', label: '轻装', prompt: '轻量服装与护具，强调灵活性和活动范围' },
          { id: 'armor', label: '重甲', prompt: '分件式重型护甲，关节活动结构与防护逻辑合理' },
          { id: 'ceremonial', label: '礼服', prompt: '仪式性礼服结构，身份符号、纹章与装饰秩序明确' },
        ],
      },
      {
        key: 'detailDensity',
        group: 'wardrobe',
        label: '细节密度',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'production', label: '生产均衡', prompt: '生产可控的中等细节密度，主次关系明确，避免无意义碎细节' },
          { id: 'restrained', label: '简洁', prompt: '克制简洁的形面与装饰，依靠轮廓和配色建立识别度' },
          { id: 'rich', label: '丰富', prompt: '丰富但有秩序的服装、材质和工艺细节' },
          { id: 'ornate', label: '华丽', prompt: '高密度华丽装饰，纹样与结构服从角色身份和视觉焦点' },
        ],
      },
      {
        key: 'equipment',
        group: 'wardrobe',
        label: '装备展示',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'signature', label: '标志武器', prompt: '清晰展示一件标志性主武器或核心道具，与角色设计语言统一' },
          { id: 'none', label: '无武器', prompt: '不展示武器，把视觉重点集中在角色本体与服装' },
          { id: 'dual', label: '双持装备', prompt: '展示成对或双持装备，左右关系明确且不遮挡身体' },
          { id: 'loadout', label: '完整配装', prompt: '展示完整战斗配装，主副武器、收纳和携行位置合理' },
        ],
      },
      {
        key: 'materialSystem',
        group: 'surface',
        label: '主材质组合',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'fabric-leather', label: '布料/皮革', prompt: '以布料和皮革为主，软硬、粗细和反光层级清楚' },
          { id: 'metal', label: '金属装甲', prompt: '以金属装甲为主，不同金属粗糙度、边缘磨损和厚度可信' },
          { id: 'organic', label: '生物材质', prompt: '骨骼、甲壳、皮肤或植物等生物材质层次自然自洽' },
          { id: 'tech', label: '科技复合', prompt: '科技复合材料、能源结构与功能分件具有工业设计逻辑' },
        ],
      },
      {
        key: 'surfaceCondition',
        group: 'surface',
        label: '表面状态',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'pristine', label: '崭新', prompt: '崭新洁净表面，工艺边缘锐利，避免塑料感' },
          { id: 'used', label: '使用痕迹', prompt: '适量真实使用痕迹集中在接触区、关节和边缘' },
          { id: 'battle-worn', label: '战损', prompt: '可信战损、刮痕和修补痕迹，保持主体结构完整可读' },
          { id: 'ancient', label: '古旧', prompt: '年代久远的氧化、褪色和沉积痕迹，材质差异仍然清晰' },
        ],
      },
      {
        key: 'factionTone',
        group: 'narrative',
        label: '阵营气质',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'heroic', label: '英雄', prompt: '英雄阵营气质，开放稳定的形状语言与可信荣誉符号' },
          { id: 'dark', label: '暗黑', prompt: '暗黑危险阵营气质，尖锐压迫的形状语言但避免无意义堆刺' },
          { id: 'sacred', label: '神圣', prompt: '神圣秩序阵营气质，对称结构与仪式符号克制明确' },
          { id: 'rogue', label: '游侠', prompt: '自由游侠阵营气质，非对称实用装备与旅行痕迹丰富' },
        ],
      },
      {
        key: 'powerSource',
        group: 'narrative',
        label: '力量来源',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'none', label: '无特效', prompt: '不使用能量特效，完全依靠形体、材质与装备表达能力' },
          { id: 'magic', label: '魔法', prompt: '魔法能量来源明确，符文、施法媒介与颜色系统统一' },
          { id: 'technology', label: '科技', prompt: '科技动力来源明确，能源核心、导线与发光区域具有功能逻辑' },
          { id: 'nature', label: '自然', prompt: '自然元素力量，植物、风、水、火或岩石与角色结构自然融合' },
          { id: 'corruption', label: '侵蚀', prompt: '受控的侵蚀或异化力量，扩散路径和材质变化具有叙事逻辑' },
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
          { id: 'strong', label: '强烈', prompt: '高强度宣传级特效，保留完整轮廓、面部和装备可读性' },
        ],
      },
      {
        key: 'lighting',
        group: 'lighting',
        label: '布光方式',
        options: [
          { id: 'auto', label: '自动布光', prompt: '' },
          { id: 'studio', label: '影棚光', prompt: '中性柔和影棚布光，材质、肤色和服装细节均清晰可辨' },
          { id: 'cinematic', label: '电影光', prompt: '电影感主辅光关系，明暗层次塑造角色气质' },
          { id: 'rim', label: '轮廓光', prompt: '清晰轮廓光分离主体与背景，边缘不过曝' },
          { id: 'dramatic', label: '戏剧光', prompt: '强方向性戏剧布光，保留暗部结构与关键细节' },
        ],
      },
      {
        key: 'colorDirection',
        group: 'lighting',
        label: '色彩关系',
        options: [
          { id: 'auto', label: '匹配描述', prompt: '' },
          { id: 'balanced', label: '自然平衡', prompt: '自然平衡配色，主色、辅色和强调色比例清晰' },
          { id: 'warm-cool', label: '冷暖对比', prompt: '冷暖色对比明确，色温服务于角色阵营与情绪' },
          { id: 'complementary', label: '互补色', prompt: '克制的互补色关系，强调色集中在视觉焦点' },
          { id: 'monochrome', label: '单色强调', prompt: '近似色主导，使用少量高纯度强调色建立记忆点' },
        ],
      },
      {
        key: 'background',
        group: 'lighting',
        label: '背景呈现',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'studio', label: '纯色影棚', prompt: '克制纯色影棚背景，主体与背景明度清晰分离' },
          { id: 'gradient', label: '渐变氛围', prompt: '简洁渐变氛围背景，不出现抢夺主体的具体物件' },
          { id: 'environment', label: '叙事场景', prompt: '与角色身份匹配的简化叙事场景，背景细节服从主体' },
        ],
      },
      {
        key: 'variationMode',
        group: 'production',
        label: '批次策略',
        requiresBatch: true,
        options: [
          { id: 'balanced', label: '平衡探索', prompt: '批量结果保持同一需求，每张探索不同但合理的设计方向' },
          { id: 'diverse', label: '扩大差异', prompt: '批量结果显著改变轮廓、服装结构与配色方向，避免近似复制' },
          { id: 'consistent', label: '锁定角色', prompt: '批量结果严格保持同一角色身份、脸部、体型和核心服装，只改变姿态或细节方案' },
          { id: 'costume', label: '服装变体', prompt: '批量结果保持同一角色身份和体型，重点探索同世界观下的服装变体' },
        ],
      },
      {
        key: 'silhouetteLanguage',
        group: 'production',
        label: '轮廓语言',
        options: [
          { id: 'auto', label: '自动', prompt: '' },
          { id: 'compact', label: '紧凑', prompt: '紧凑稳定轮廓，挂件收束，适合高频战斗读取' },
          { id: 'flowing', label: '飘逸', prompt: '飘逸外轮廓，长摆、披风或发束形成清晰动势' },
          { id: 'angular', label: '锐利', prompt: '锐利方向性轮廓，尖角集中在关键识别区' },
          { id: 'massive', label: '巨型', prompt: '巨型高体量轮廓，重心、承重与比例关系可信' },
        ],
      },
      {
        key: 'referenceFidelity',
        group: 'reference',
        label: '还原强度',
        requiresReference: true,
        options: [
          { id: 'balanced', label: '平衡还原', prompt: '保留参考图身份、脸部、轮廓与核心服装，同时进行生产级优化' },
          { id: 'strict', label: '严格还原', prompt: '严格保持参考图角色身份、脸部、发型、体型、服装和配色，不重新设计' },
          { id: 'identity', label: '锁定身份', prompt: '锁定参考图人物身份和脸部特征，允许重新设计服装、装备与姿态' },
          { id: 'inspiration', label: '仅作灵感', prompt: '仅提取参考图的视觉气质与设计语言，不复制具体身份和造型' },
        ],
      },
    ],
    toggles: [
      { key: 'transparent', group: 'composition', label: '透明背景', icon: 'bi-transparency', prompt: '纯净透明背景，主体边缘干净' },
      { key: 'visibleFace', group: 'production', label: '面部无遮挡', icon: 'bi-person-bounding-box', prompt: '脸部和双眼清晰可见，不被头发、特效、武器或阴影遮挡' },
      { key: 'visibleHands', group: 'production', label: '双手完整', icon: 'bi-hand-index', prompt: '双手完整可见，手指结构自然，持握关系正确，不被裁切' },
      { key: 'modularParts', group: 'production', label: '支持拆件', icon: 'bi-boxes', prompt: '服装、护甲、武器和挂件分层明确，连接点清楚，适合后续建模拆件' },
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
    selects: [
      {
        key: 'view',
        label: '视角',
        options: [
          { id: 'wide', label: '广角全景', prompt: '广角全景构图，前中后景层次分明，有视觉引导线' },
          { id: 'isometric', label: '等距俯瞰', prompt: '等距 isometric 视角，适合策略与模拟游戏' },
          { id: 'side', label: '横版卷轴', prompt: '横版卷轴游戏场景，可行走平台层次清晰' },
          { id: 'topdown', label: '俯视地图', prompt: '自上而下俯视角，适合 RPG 地图与关卡俯瞰' },
        ],
      },
      {
        key: 'mood',
        label: '时间氛围',
        options: [
          { id: 'day', label: '白昼', prompt: '白昼明亮自然光照' },
          { id: 'dusk', label: '黄昏', prompt: '黄昏暖色逆光，长投影' },
          { id: 'night', label: '夜晚', prompt: '夜晚冷色基调与人工光源点缀' },
          { id: 'storm', label: '雨雾', prompt: '雨雾弥漫的湿润氛围，空气透视强' },
        ],
      },
    ],
    toggles: [],
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
    selects: [
      {
        key: 'layout',
        label: '展示方式',
        options: [
          { id: 'single', label: '单件展示', prompt: '单件道具居中完整展示' },
          { id: 'sheet', label: '多角度图鉴', prompt: '同一道具的多角度视图排列成设定图鉴' },
          { id: 'set', label: '同系列一组', prompt: '同一风格系列的一组道具整齐排列，风格严格统一' },
        ],
      },
    ],
    toggles: [{ key: 'transparent', label: '透明背景', prompt: '纯净透明背景，主体边缘干净' }],
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
      { label: '科幻 HUD', text: '硬科幻太空射击游戏的战斗界面，全息投影质感，青色描边，信息密度高' },
      { label: '休闲主菜单', text: '休闲消除手游主菜单，奶油色圆角卡片，大按钮，活泼气泡装饰' },
      { label: '暗黑背包', text: '暗黑风 ARPG 背包界面，铁艺格子，羊皮纸属性面板，血红强调色' },
    ],
    aspects: ['16:9', '9:16', '4:3'],
    defaultAspect: '16:9',
    selects: [
      {
        key: 'screen',
        label: '界面类型',
        options: [
          { id: 'hud', label: '战斗 HUD', prompt: '战斗 HUD 界面：血条、技能栏、小地图、任务追踪等控件布局完整' },
          { id: 'menu', label: '主菜单', prompt: '主菜单界面：游戏标题、开始/继续/设置入口、主视觉背景' },
          { id: 'inventory', label: '背包库存', prompt: '背包/库存界面：物品格子系统、装备栏、角色属性面板' },
          { id: 'shop', label: '商店', prompt: '游戏内商店界面：商品卡片、货币栏、购买按钮、限时促销位' },
          { id: 'result', label: '结算弹窗', prompt: '战斗结算弹窗：评级星级、奖励列表、经验条、按钮组' },
        ],
      },
    ],
    toggles: [],
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
    selects: [
      {
        key: 'kind',
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
        label: '排列',
        options: [
          { id: 'single', label: '单个大图', prompt: '单个图标居中展示' },
          { id: 'grid', label: '3x3 图标集', prompt: '同一风格的 9 个不同图标排成 3x3 网格，风格与光源严格统一' },
        ],
      },
    ],
    toggles: [{ key: 'transparent', label: '透明背景', prompt: '纯净透明背景，主体边缘干净' }],
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
    selects: [
      {
        key: 'material',
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
    ],
    toggles: [
      { key: 'seamless', label: '无缝平铺', prompt: '无缝可平铺贴图（seamless tileable），四边完全衔接，无明显重复感' },
    ],
    line: '游戏贴图素材，均匀漫反射照明，无高光热点、无阴影投射、无景深、无透视畸变。',
    shareCategory: 'other',
  },
]

// swatch 是纯 CSS 背景，用色彩气质示意风格，避免加载图片资源。
const STYLE_OPTIONS = [
  {
    id: 'stylized-3d',
    label: '风格化 3D',
    prompt: '风格化 3D 渲染，形体夸张有度，颜色饱满',
    swatch: 'radial-gradient(90% 120% at 30% 20%, #ffb54d 0%, #ff7847 34%, #35dcff 100%)',
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
]

const {
  authStore,
  creditsPrompt,
  modelId, models, status, error, running, cancelling, historyLoading, historyHasMore,
  outputs, activeOutput, outputJobIds, outputKinds, batchProgress,
  initialize, generate: generateImage, cancel: cancelGeneration,
  deleteOutput, formatCostEstimate, loadMoreHistory,
} = useCreativeImageJob({
  source: 'game-art-studio',
  featureKey: 'ai.gameDesign',
  jobKindPrefix: 'game-art',
  // 任务 kind 按资产类型细分（game-art-character-generation…），
  // 历史记录据此归类到各自的 tab，不再六类混在一条胶片里。
  kindVariants: ASSET_TYPES.map((type) => type.id),
  preferOriginalOutputs: true,
})

const assetType = ref('character')
const style = ref('stylized-3d')
const imageCount = ref(1)
const hdMode = ref(true)
const negative = ref('模糊，低清晰度，错误肢体，文字，水印，照片样机，裁切主体')
const sourcePreview = ref('')
const inputFile = ref(null)
const referenceUrl = ref('')
const fileInput = ref(null)
const studioRoot = ref(null)
const localError = ref('')
const showGrid = ref(true)
const fullscreenOpen = ref(false)
const libraryOpen = ref(false)
const libraryTab = ref('history')
const myAssets = ref([])
const assetsLoading = ref(false)
const assetsLoaded = ref(false)
const publishOpen = ref(false)
const publishTargetUrl = ref('')
const submittingShare = ref(false)
const pendingDeleteUrl = ref('')
const promptItems = ref([])
const promptLoading = ref(false)
const promptHasMore = ref(false)
const promptPage = ref(1)
const promptQuery = ref('')
const promptLoaded = ref(false)
let pendingDeleteTimer = 0

const typeState = reactive(
  Object.fromEntries(
    ASSET_TYPES.map((type) => [
      type.id,
      {
        prompt: type.defaultPrompt,
        aspect: type.defaultAspect,
        selects: Object.fromEntries((type.selects || []).map((item) => [item.key, item.options[0].id])),
        toggles: Object.fromEntries((type.toggles || []).map((item) => [item.key, item.key === 'seamless'])),
      },
    ]),
  ),
)

// —— 刷新不丢状态：恢复各资产类型的草稿与全局参数 ——
try {
  const saved = JSON.parse(getScopedLocalItem(SETTINGS_KEY) || 'null')
  if (saved && typeof saved === 'object') {
    if (ASSET_TYPES.some((type) => type.id === saved.assetType)) assetType.value = saved.assetType
    if (STYLE_OPTIONS.some((item) => item.id === saved.style)) style.value = saved.style
    if ([1, 2, 3, 4].includes(saved.imageCount)) imageCount.value = saved.imageCount
    if (typeof saved.hdMode === 'boolean') hdMode.value = saved.hdMode
    if (typeof saved.negative === 'string') negative.value = saved.negative
    if (typeof saved.showGrid === 'boolean') showGrid.value = saved.showGrid
    if (typeof saved.referenceUrl === 'string' && saved.referenceUrl) referenceUrl.value = saved.referenceUrl
    if (saved.typeState && typeof saved.typeState === 'object') {
      for (const type of ASSET_TYPES) {
        const entry = saved.typeState[type.id]
        if (!entry || typeof entry !== 'object') continue
        if (typeof entry.prompt === 'string' && entry.prompt.trim()) typeState[type.id].prompt = entry.prompt
        if (type.aspects.includes(entry.aspect)) typeState[type.id].aspect = entry.aspect
        for (const select of type.selects || []) {
          if (select.options.some((option) => option.id === entry.selects?.[select.key])) {
            typeState[type.id].selects[select.key] = entry.selects[select.key]
          }
        }
        for (const toggle of type.toggles || []) {
          if (typeof entry.toggles?.[toggle.key] === 'boolean') {
            typeState[type.id].toggles[toggle.key] = entry.toggles[toggle.key]
          }
        }
      }
    }
  }
} catch {
  /* 忽略损坏的本地存档 */
}

watch(
  [
    assetType,
    style,
    imageCount,
    hdMode,
    negative,
    showGrid,
    referenceUrl,
    () => JSON.stringify(typeState),
  ],
  () => {
    setScopedLocalItem(
      SETTINGS_KEY,
      JSON.stringify({
        assetType: assetType.value,
        style: style.value,
        imageCount: imageCount.value,
        hdMode: hdMode.value,
        negative: negative.value,
        showGrid: showGrid.value,
        referenceUrl: referenceUrl.value,
        typeState,
      }),
    )
  },
)

const currentType = computed(() => ASSET_TYPES.find((type) => type.id === assetType.value) || ASSET_TYPES[0])

// —— 作品按资产类型隔离：每个 tab 只看到自己的胶片条与选中图 ——
function outputTypeOf(url) {
  const kind = String(outputKinds.value[url] || '')
  const match = kind.match(/^game-art-(.+)-(?:generation|edit)$/)
  return match && ASSET_TYPES.some((type) => type.id === match[1]) ? match[1] : ''
}

function outputTypeLabel(url) {
  const typeId = outputTypeOf(url)
  return ASSET_TYPES.find((type) => type.id === typeId)?.label || '早期'
}

const typeOutputs = computed(() =>
  outputs.value.filter((url) => outputTypeOf(url) === assetType.value),
)
const fullscreenOutputs = computed(() => {
  const list = typeOutputs.value.length ? typeOutputs.value : outputs.value
  const current = String(activeOutput.value || '')
  return current && !list.includes(current) ? [current, ...list] : list
})
// 未细分类型前生成的早期作品，统一收在资产库里查看。
const legacyOutputs = computed(() => outputs.value.filter((url) => !outputTypeOf(url)))

// —— 画布只弹「最近一批」结果卡片，全部历史收在资产库 ——
const latestBatch = ref([])
let outputsBeforeRun = []

watch(running, (isRunning) => {
  if (isRunning) {
    outputsBeforeRun = [...outputs.value]
    return
  }
  const fresh = outputs.value.filter(
    (url) => !outputsBeforeRun.includes(url) && outputTypeOf(url) === assetType.value,
  )
  if (fresh.length) {
    latestBatch.value = fresh
    playCanvasReveal()
  }
})

// —— 抽卡揭晓（画布内完成）：卡背旋入 → 金色光带自上而下擦亮成图 → 边缘闪光收尾 ——
// 需在结果卡片插入 DOM 前同步置 true，让进场动画与卡背遮罩一起生效。
const freshReveal = ref(false)
let freshRevealTimer = 0

function playCanvasReveal() {
  window.clearTimeout(freshRevealTimer)
  freshReveal.value = true
  freshRevealTimer = window.setTimeout(() => {
    freshReveal.value = false
  }, 3600)
}

const busy = computed(() => running.value)
const overlayStatus = computed(() => status.value || '生成高清游戏素材')
const progressEntries = computed(() => batchProgress.value)

watch(assetType, () => {
  latestBatch.value = []
})

// 画布卡片：优先展示刚生成的一批；否则回放当前类型的最近作品。
// 浏览态（3D 堆叠）多展示几张，形成隧道景深；揭晓态仍只看最近一批。
const canvasOutputs = computed(() => {
  const batch = latestBatch.value.filter((url) => outputs.value.includes(url))
  if (batch.length) return batch
  // 堆叠最多 6 张：更深的卡肉眼几乎不可见，但每张都是一个合成层，白白吃 GPU
  return typeOutputs.value.slice(0, 6)
})

// 真实生成忙碌态（不含演示揭晓）——揭晓期间仍用平面抽卡，结束后切 3D 堆叠。
const preferFlatReveal = computed(() => freshReveal.value)
const deckEnabled = computed(
  () => canvasOutputs.value.length > 0 && !preferFlatReveal.value && !busy.value,
)
const prefersReducedMotion = ref(
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
)
const deckResults = ref(null)
const {
  active: deckActive,
  entered: deckEntered,
  dragging: deckDragging,
  frontIndex: deckFrontIndex,
  onWheel: onDeckWheel,
  onPointerDown: onDeckPointerDown,
  onPointerMove: onDeckPointerMove,
  onPointerUp: onDeckPointerUp,
  onPointerLeave: onDeckPointerLeave,
  settle: settleDeck,
} = useCanvasDeck({
  items: canvasOutputs,
  enabled: deckEnabled,
  reducedMotion: prefersReducedMotion,
  getContainer: () => deckResults.value?.$el ?? deckResults.value,
})

// 抽卡揭晓收尾后，成图直接定格为堆叠终态（刷新进入同样不跑进场动画）
watch(freshReveal, (open, wasOpen) => {
  if (wasOpen && !open && canvasOutputs.value.length) {
    void nextTick(() => settleDeck())
  }
})

// 记录每张成图的真实宽高比，画布卡片按图片比例贴合展示（无黑边）。
const outputAspects = reactive({})

function recordAspect(url, event) {
  const img = event?.target
  if (img?.naturalWidth && img?.naturalHeight) {
    outputAspects[url] = img.naturalWidth / img.naturalHeight
  }
}

const defaultAspectNumber = computed(() => {
  const [w, h] = currentState.value.aspect.split(':').map(Number)
  return w && h ? w / h : 0.75
})

function aspectNumberOf(url) {
  return outputAspects[url] || defaultAspectNumber.value
}

// 加载失败的图渲染成出错卡片，可重试或删除。
const failedOutputs = reactive({})
const retryNonce = reactive({})

function markFailed(url) {
  failedOutputs[url] = true
}

function retryFailed(url) {
  delete failedOutputs[url]
  retryNonce[url] = (retryNonce[url] || 0) + 1
}

function openFullscreen(url) {
  activeOutput.value = url
  fullscreenOpen.value = true
}

// 中西文混排时补空格：「游戏 UI 设计」而非「游戏 UI设计」
const currentTypeHeading = computed(() => {
  const label = currentType.value.label
  return /[A-Za-z0-9]$/.test(label) ? `${label} 设计` : `${label}设计`
})
const currentState = computed(() => typeState[assetType.value])
const hasReference = computed(() => Boolean(inputFile.value || referenceUrl.value))

function isSelectRelevant(select) {
  if (select.requiresReference && !hasReference.value) return false
  if (select.requiresBatch && imageCount.value < 2) return false
  if (select.key === 'background' && transparentEnabled.value) return false
  if (
    select.key === 'vfxIntensity' &&
    ['auto', 'none'].includes(currentState.value.selects.powerSource)
  ) {
    return false
  }
  if (
    assetType.value === 'character' &&
    currentState.value.selects.framing === 'turnaround' &&
    ['camera', 'stance', 'expression', 'gaze'].includes(select.key)
  ) {
    return false
  }
  return true
}

const currentControlGroups = computed(() => {
  const definitions = currentType.value.controlGroups || [
    { id: 'specs', label: '呈现与规格', output: true },
  ]
  return definitions
    .map((group) => ({
      ...group,
      selects: currentType.value.selects.filter(
        (select) => (select.group || 'specs') === group.id && isSelectRelevant(select),
      ),
      toggles: currentType.value.toggles.filter(
        (toggle) => (toggle.group || 'specs') === group.id,
      ),
    }))
    .filter((group) => group.output || group.selects.length || group.toggles.length)
    .map((group, index) => ({ ...group, number: String(index + 1).padStart(2, '0') }))
})

const styleSectionNumber = computed(() => String(currentControlGroups.value.length + 1).padStart(2, '0'))
const qualitySectionNumber = computed(() => String(currentControlGroups.value.length + 2).padStart(2, '0'))
const currentStyle = computed(() => STYLE_OPTIONS.find((item) => item.id === style.value) || STYLE_OPTIONS[0])
const transparentEnabled = computed(() => currentState.value.toggles.transparent === true)
const publishJobId = computed(() => outputJobIds.value[publishTargetUrl.value] || '')
const costLabel = computed(() => formatCostEstimate(imageCount.value))
const costDisplay = computed(() => {
  const text = String(costLabel.value || '').trim()
  const value = text.replace(/^预计\s*/, '')
  const detailStart = value.indexOf('（')
  if (detailStart >= 0 && value.endsWith('）')) {
    return {
      price: value.slice(0, detailStart).trim(),
      detail: value.slice(detailStart + 1, -1).trim(),
    }
  }
  const perImage = value.match(/^((?:¥|\$)\s*\d+(?:\.\d+)?)\s*(\/\s*张)$/)
  if (perImage) return { price: perImage[1], detail: perImage[2] }
  return { price: value, detail: '' }
})
const showBatchProgress = computed(() => progressEntries.value.length > 1)

// 资产库历史筛选：全部 / 仅早期未分类作品
const historyFilter = ref('all')
const libraryHistoryOutputs = computed(() =>
  historyFilter.value === 'legacy' ? legacyOutputs.value : outputs.value,
)
watch(legacyOutputs, (list) => {
  if (!list.length) historyFilter.value = 'all'
})

// 固定画质基线：正向增强 + 负向排除，随每次生成注入（用户可编辑的负面约束在其之上叠加）。
const QUALITY_POSITIVE = '干净高清画面，平滑3D动画渲染，细腻材质，纯净色彩，清晰边缘，无瑕疵背景，均匀光照'
const QUALITY_NEGATIVE = ['颗粒感', '噪点', '污点', '脏纹理', '杂色斑点', '胶片颗粒', '压缩痕迹', '像素化', '过度锐化', '碎片感']

const promptBlueprint = computed(() => {
  const type = currentType.value
  const state = currentState.value
  const lines = [state.prompt.trim() || type.defaultPrompt]
  lines.push(`游戏资产类型：${type.label}。${type.line}`)
  for (const select of type.selects || []) {
    if (!isSelectRelevant(select)) continue
    const option = select.options.find((item) => item.id === state.selects[select.key])
    if (option?.prompt) lines.push(`${select.label}：${option.prompt}。`)
  }
  if (type.id === 'character' && state.selects.framing === 'turnaround') {
    lines.push('三视图制作约束：中性 A-pose，正交相机，无透视畸变，正面、侧面和背面高度完全一致，无遮挡。')
  }
  lines.push(`美术风格：${currentStyle.value.prompt}。`)
  for (const toggle of type.toggles || []) {
    if (toggle.key !== 'transparent' && state.toggles[toggle.key]) lines.push(`${toggle.prompt}。`)
  }
  lines.push(
    '生产要求：可直接用于游戏开发的高清资产，轮廓明确，材质可辨识，光照服务于形体，完整展示主体，细节经得起放大。',
  )
  lines.push(
    transparentEnabled.value
      ? '画质要求：干净高清主体，平滑抗锯齿轮廓，细腻材质，纯净色彩，清晰边缘，边缘透明度自然。'
      : `画质要求：${QUALITY_POSITIVE}。`,
  )
  // 像素美术本身就要像素颗粒与像素化，冲突项不排除
  const qualityNegative = QUALITY_NEGATIVE.filter(
    (item) => style.value !== 'pixel-art' || !['像素化', '颗粒感'].includes(item),
  )
  const negativeParts = [negative.value.trim(), qualityNegative.join('、')].filter(Boolean)
  lines.push(`负面约束：${negativeParts.join('，')}。`)
  return withTransparentPngInstruction(lines.join('\n'), transparentEnabled.value)
})

useStudioMotion(studioRoot, activeOutput)

let renderMotion = null

watch(
  busy,
  async (active) => {
    renderMotion?.revert()
    renderMotion = null
    if (!active) return
    await nextTick()
    if (!busy.value || !studioRoot.value) return

    renderMotion = gsap.matchMedia()
    renderMotion.add(
      {
        allowMotion: '(prefers-reduced-motion: no-preference)',
        reduceMotion: '(prefers-reduced-motion: reduce)',
      },
      ({ conditions }) => {
        if (conditions.reduceMotion) {
          gsap.set('.ga-render-stage, .ga-render-copy, .ga-render-actions', { autoAlpha: 1 })
          return
        }

        gsap.from('.ga-render-stage', {
          autoAlpha: 0,
          scale: 0.9,
          duration: 0.7,
          ease: 'power3.out',
        })
        gsap.from('.ga-render-copy, .ga-progress, .ga-render-actions', {
          autoAlpha: 0,
          y: 10,
          duration: 0.5,
          ease: 'power2.out',
          stagger: 0.07,
        })
        gsap.to('.ga-signal-orbit.is-outer', {
          rotation: 360,
          duration: 9,
          ease: 'none',
          repeat: -1,
        })
        gsap.to('.ga-signal-orbit.is-inner', {
          rotation: -360,
          duration: 5.5,
          ease: 'none',
          repeat: -1,
        })
        gsap.to('.ga-signal-sweep', {
          rotation: 360,
          duration: 3.6,
          ease: 'none',
          repeat: -1,
        })
        gsap.to('.ga-signal-wave', {
          autoAlpha: 0,
          scale: 1.45,
          duration: 2.2,
          ease: 'power2.out',
          stagger: 0.72,
          repeat: -1,
        })
        gsap.to('.ga-signal-bar', {
          scaleY: (index) => [0.45, 1, 0.68, 0.9][index] || 0.6,
          duration: 0.58,
          ease: 'sine.inOut',
          stagger: { each: 0.09, repeat: -1, yoyo: true },
          transformOrigin: '50% 100%',
        })
      },
      studioRoot.value,
    )
  },
  { flush: 'post' },
)

onMounted(() => {
  initialize()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('paste', handlePaste)
})

onBeforeUnmount(() => {
  renderMotion?.revert()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('paste', handlePaste)
  window.clearTimeout(freshRevealTimer)
})

function handleKeydown(event) {
  if (event.key === 'Escape') {
    if (fullscreenOpen.value) {
      event.preventDefault()
      fullscreenOpen.value = false
    } else if (libraryOpen.value && !publishOpen.value) {
      event.preventDefault()
      libraryOpen.value = false
    }
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !busy.value) {
    event.preventDefault()
    generate()
  }
}

async function applySourceFile(file) {
  if (!file || !file.type?.startsWith('image/')) return
  inputFile.value = file
  sourcePreview.value = await readImageFile(file)
  referenceUrl.value = ''
  localError.value = ''
}

async function chooseFile(event) {
  await applySourceFile(event.target.files?.[0])
}

const dropActive = ref(false)

async function handleReferenceDrop(event) {
  dropActive.value = false
  await applySourceFile(event.dataTransfer?.files?.[0])
}

// 粘贴截图/图片即挂为参考图（对齐主流生成工作台的习惯）。
async function handlePaste(event) {
  const item = Array.from(event.clipboardData?.items || []).find((entry) =>
    entry.type?.startsWith('image/'),
  )
  if (!item) return
  const file = item.getAsFile()
  if (!file) return
  event.preventDefault()
  await applySourceFile(file)
  notificationService.success('已粘贴为参考图')
}

function clearSource() {
  inputFile.value = null
  sourcePreview.value = ''
  referenceUrl.value = ''
  localError.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function useOutputAsReference(url = '') {
  const target = String(url || activeOutput.value || '').trim()
  if (!target) return
  referenceUrl.value = target
  inputFile.value = null
  sourcePreview.value = ''
  if (fileInput.value) fileInput.value.value = ''
  localError.value = ''
  notificationService.success('已设为参考图，下次生成将基于它重绘')
}

function applyExample(text) {
  currentState.value.prompt = text
  localError.value = ''
}

function generate() {
  localError.value = ''
  const state = currentState.value
  if (!state.prompt.trim() && !inputFile.value && !referenceUrl.value) {
    localError.value = '请先写一段创意描述，或挂一张参考图'
    return
  }
  generateImage({
    prompt: promptBlueprint.value,
    file: inputFile.value,
    sourceUrl: referenceUrl.value,
    aspectRatio: state.aspect,
    count: imageCount.value,
    quality: hdMode.value ? 'high' : 'medium',
    transparentPngEnabled: transparentEnabled.value,
    upscaleOutputFormat: transparentEnabled.value ? 'png' : 'auto',
    viewLabel: currentType.value.label,
    kindVariant: assetType.value,
  })
}

async function downloadOutput(url = '') {
  const target = String(url || activeOutput.value || '').trim()
  if (!target) return
  localError.value = ''
  try {
    await downloadAuthenticatedMedia(target, `game-${assetType.value}-${Date.now()}.png`)
  } catch (caught) {
    localError.value = caught?.message || '游戏资产下载失败'
  }
}

function requestDeleteOutput(url) {
  if (busy.value) return
  if (pendingDeleteUrl.value !== url) {
    pendingDeleteUrl.value = url
    window.clearTimeout(pendingDeleteTimer)
    pendingDeleteTimer = window.setTimeout(() => {
      pendingDeleteUrl.value = ''
    }, 3200)
    return
  }
  window.clearTimeout(pendingDeleteTimer)
  pendingDeleteUrl.value = ''
  deleteOutput(url)
    .then(() => notificationService.success('已删除该输出及其云端任务'))
    .catch((caught) => notificationService.error(caught?.message || '删除失败'))
}

function openLibrary(tab = 'history') {
  libraryTab.value = tab
  libraryOpen.value = true
  if (tab === 'published' && !assetsLoaded.value) void loadMyAssets()
  if (tab === 'prompts' && !promptLoaded.value) void loadPromptEntries(true)
}

function switchLibraryTab(tab) {
  libraryTab.value = tab
  if (tab === 'published' && !assetsLoaded.value) void loadMyAssets()
  if (tab === 'prompts' && !promptLoaded.value) void loadPromptEntries(true)
}

const filteredPrompts = computed(() => {
  const query = promptQuery.value.trim().toLowerCase()
  if (!query) return promptItems.value
  return promptItems.value.filter((item) =>
    `${item?.title || ''} ${item?.prompt || ''}`.toLowerCase().includes(query),
  )
})

async function loadPromptEntries(reset = false) {
  if (promptLoading.value) return
  promptLoading.value = true
  try {
    const nextPage = reset ? 1 : promptPage.value + 1
    const response = await listPromptLibrary('game_art', { pageNumber: nextPage, pageSize: 24 })
    const incoming = Array.isArray(response?.items) ? response.items : []
    promptItems.value = reset
      ? incoming
      : Array.from(new Map([...promptItems.value, ...incoming].map((item) => [item.id, item])).values())
    promptPage.value = Number(response?.page || nextPage)
    promptHasMore.value = response?.hasMore === true
    promptLoaded.value = true
  } catch (caught) {
    if (reset) promptItems.value = []
    notificationService.error(caught?.message || '提示词库读取失败')
  } finally {
    promptLoading.value = false
  }
}

function usePromptEntry(item) {
  const text = String(item?.prompt || '').trim()
  if (!text) return
  currentState.value.prompt = text
  if (item?.id) void recordPromptEngagement(item.id, 'use').catch(() => undefined)
  libraryOpen.value = false
  notificationService.success('已填入创意描述，可继续修改后生成')
}

async function loadMyAssets() {
  if (assetsLoading.value) return
  // 未登录时接口必然 401，直接显示空态提示即可
  if (!authStore.isAuthenticated) {
    myAssets.value = []
    assetsLoaded.value = true
    return
  }
  assetsLoading.value = true
  try {
    const response = await listMyShareAssets({ page: 1, pageSize: 48 })
    const items = Array.isArray(response?.items) ? response.items : []
    // 只展示从本工作台推送的资产（按任务 kind 过滤），其他页面的作品不混入。
    myAssets.value = items.filter((item) => String(item?.kind || '').startsWith('game-art'))
    assetsLoaded.value = true
  } catch (caught) {
    notificationService.error(caught?.message || '我的资产读取失败')
  } finally {
    assetsLoading.value = false
  }
}

// 资产库里点作品直接全屏预览（抽屉保持在下层，Esc 逐层退出）。
function pickFromLibrary(url) {
  localError.value = ''
  openFullscreen(url)
}

function openPublish(url = '') {
  const target = String(url || activeOutput.value || '').trim()
  if (!target) return
  if (!outputJobIds.value[target]) {
    notificationService.warning('这张图缺少云端任务信息，暂时无法发布')
    return
  }
  publishTargetUrl.value = target
  publishOpen.value = true
}

async function submitPublish(payload) {
  if (!publishJobId.value || submittingShare.value) return
  submittingShare.value = true
  try {
    await submitShareItem({
      jobId: publishJobId.value,
      styleLabel: currentStyle.value.label,
      ...payload,
    })
    publishOpen.value = false
    publishTargetUrl.value = ''
    notificationService.success('已提交到广场审核，通过后会公开展示')
    assetsLoaded.value = false
    if (libraryOpen.value && libraryTab.value === 'published') void loadMyAssets()
  } catch (caught) {
    notificationService.error(caught?.message || '发布失败，请稍后重试')
  } finally {
    submittingShare.value = false
  }
}

function assetStatusLabel(statusValue) {
  if (statusValue === 'approved') return '已发布'
  if (statusValue === 'rejected') return '未通过'
  return '审核中'
}
</script>

<template>
  <main ref="studioRoot" class="game-art-studio">
    <aside class="ga-rail" data-studio-enter>
      <button
        v-for="type in ASSET_TYPES"
        :key="type.id"
        type="button"
        :class="{ active: assetType === type.id }"
        :title="type.label"
        @click="assetType = type.id"
      >
        <i class="bi" :class="type.icon"></i><span>{{ type.label }}</span>
      </button>
      <button class="ga-library" type="button" title="历史记录与我的资产" @click="openLibrary('history')">
        <i class="bi bi-collection"></i><span>资产库</span>
      </button>
    </aside>

    <section class="ga-main">
      <div class="ga-workspace">
        <section class="ga-canvas" data-studio-enter>
          <div class="ga-canvas-head">
            <div class="ga-canvas-title">
              <Transition name="ga-type" mode="out-in">
                <strong :key="assetType">{{ currentTypeHeading }}</strong>
              </Transition>
              <span class="ga-canvas-status" :class="{ working: busy }">
                <i></i>{{ busy ? status || 'RENDERING' : `READY / ${currentState.aspect}` }}
                <template v-if="!busy && typeOutputs.length"> / {{ typeOutputs.length }} 张</template>
              </span>
            </div>
            <div class="ga-canvas-tools">
              <label class="ga-model-pick" title="切换生成模型">
                <i class="bi bi-cpu" aria-hidden="true"></i>
                <select v-model="modelId" aria-label="生成模型">
                  <option v-for="model in models" :key="model.id" :value="model.id">
                    {{ model.label }}{{ model.creditCost ? ` · ${model.creditCost} 积分/张` : '' }}
                  </option>
                </select>
              </label>
              <button type="button" title="显示网格" :class="{ active: showGrid }" @click="showGrid = !showGrid">
                <i class="bi bi-grid"></i>
              </button>
            </div>
          </div>
          <div
            class="ga-output"
            :class="{ 'grid-off': !showGrid, 'is-deck': deckActive }"
            @wheel="onDeckWheel"
            @pointerdown="onDeckPointerDown"
            @pointermove="onDeckPointerMove"
            @pointerup="onDeckPointerUp"
            @pointercancel="onDeckPointerUp"
            @pointerleave="onDeckPointerLeave"
          >
            <div v-if="deckActive" class="ga-deck-fx" aria-hidden="true">
              <i v-for="n in 7" :key="n" class="ga-deck-orb" :style="{ '--o': n }"></i>
              <span class="ga-deck-ribbon"></span>
            </div>
            <TransitionGroup
              v-if="canvasOutputs.length"
              ref="deckResults"
              name="ga-pop"
              tag="div"
              class="ga-results"
              :class="{
                'is-fresh': freshReveal,
                'is-deck': deckActive,
                'is-deck-entered': deckEntered,
                'is-deck-dragging': deckDragging,
              }"
              :data-count="canvasOutputs.length"
              appear
            >
              <article
                v-for="(output, index) in canvasOutputs"
                :key="output"
                class="ga-card"
                :class="{ 'is-front': deckActive && index === deckFrontIndex }"
                :style="{ '--i': index, '--car': aspectNumberOf(output) }"
              >
                <div v-if="failedOutputs[output]" class="ga-card-error">
                  <svg viewBox="0 0 64 64" aria-hidden="true">
                    <rect x="6" y="10" width="52" height="44" rx="5" />
                    <path d="M6 44 22 30l10 9 12-13 14 15" />
                    <circle cx="23" cy="23" r="4.5" />
                    <path class="ga-card-error-slash" d="M10 58 54 6" />
                  </svg>
                  <strong>图像加载失败</strong>
                  <div class="ga-card-error-actions">
                    <button type="button" @click="retryFailed(output)"><i class="bi bi-arrow-clockwise"></i>重试</button>
                    <button
                      type="button"
                      :class="{ 'is-armed': pendingDeleteUrl === output }"
                      @click="requestDeleteOutput(output)"
                    >
                      <i class="bi" :class="pendingDeleteUrl === output ? 'bi-question-lg' : 'bi-trash3'"></i>
                      {{ pendingDeleteUrl === output ? '确认删除' : '删除' }}
                    </button>
                  </div>
                </div>
                <template v-else>
                  <button type="button" class="ga-card-view" title="点击查看大图" @click="openFullscreen(output)">
                    <AuthenticatedImage
                      :key="`${output}#${retryNonce[output] || 0}`"
                      :src="output"
                      alt="游戏美术资产"
                      loading="eager"
                      :retry-count="2"
                      @load="recordAspect(output, $event)"
                      @error="markFailed(output)"
                    />
                  </button>
                  <template v-if="freshReveal">
                    <span class="ga-card-back" aria-hidden="true">
                      <i class="bi" :class="currentType.icon"></i>
                      <em>STARCLOUD FORGE</em>
                    </span>
                    <span class="ga-card-sweep" aria-hidden="true"></span>
                  </template>
                  <div class="ga-card-actions">
                    <button type="button" :disabled="busy" title="以它为参考继续生成" @click="useOutputAsReference(output)">
                      <i class="bi bi-pin-angle"></i>
                    </button>
                    <button type="button" :disabled="!outputJobIds[output]" title="发布到广场" @click="openPublish(output)">
                      <i class="bi bi-broadcast"></i>
                    </button>
                    <button type="button" title="下载" @click="downloadOutput(output)">
                      <i class="bi bi-download"></i>
                    </button>
                    <button
                      type="button"
                      :class="{ 'is-armed': pendingDeleteUrl === output }"
                      :title="pendingDeleteUrl === output ? '再点一次确认删除' : '删除'"
                      @click="requestDeleteOutput(output)"
                    >
                      <i class="bi" :class="pendingDeleteUrl === output ? 'bi-question-lg' : 'bi-trash3'"></i>
                    </button>
                  </div>
                </template>
              </article>
            </TransitionGroup>
            <div v-else-if="historyLoading" class="ga-results" data-count="3" aria-hidden="true">
              <span v-for="n in 3" :key="n" class="ga-card ga-card-skeleton" :style="{ '--car': defaultAspectNumber }"></span>
            </div>
            <div v-else class="ga-empty">
              <Transition name="ga-type" mode="out-in">
                <div :key="assetType" class="ga-crosshair"><i class="bi" :class="currentType.icon"></i></div>
              </Transition>
              <strong>{{ currentTypeHeading }}工作台</strong>
              <em>{{ currentType.line }}</em>
              <div class="ga-inspo" role="group" aria-label="点一个灵感直接开始">
                <button
                  v-for="example in currentType.examples"
                  :key="example.label"
                  type="button"
                  @click="applyExample(example.text)"
                >
                  <strong>{{ example.label }}</strong>
                  <span>{{ example.text }}</span>
                </button>
              </div>
              <span>点一个灵感填入描述，或直接在下方输入框写下你的想法</span>
            </div>
            <div v-if="busy" class="ga-render">
              <div class="ga-render-stage" aria-hidden="true">
                <span class="ga-signal-wave is-one"></span>
                <span class="ga-signal-wave is-two"></span>
                <span class="ga-signal-wave is-three"></span>
                <span class="ga-signal-sweep"></span>
                <span class="ga-signal-orbit is-outer"><i></i><i></i><i></i></span>
                <span class="ga-signal-orbit is-inner"><i></i><i></i></span>
                <span class="ga-signal-core">
                  <i class="bi bi-stars"></i>
                  <span class="ga-signal-bars">
                    <i v-for="index in 4" :key="index" class="ga-signal-bar"></i>
                  </span>
                </span>
              </div>
              <div class="ga-render-copy" role="status" aria-live="polite" aria-atomic="true">
                <span class="ga-render-live"><i></i>RENDER PROCESS</span>
                <strong>{{ cancelling ? '正在终止云端任务' : overlayStatus }}</strong>
                <small>{{ cancelling ? '正在同步停止状态，请稍候' : '任务已进入云端渲染队列' }}</small>
              </div>
              <ul v-if="showBatchProgress" class="ga-progress" aria-label="生成进度">
                <li v-for="(entry, index) in progressEntries" :key="index" :class="`is-${entry.status}`">
                  <i
                    class="bi"
                    :class="{
                      'bi-circle': entry.status === 'pending',
                      'bi-arrow-repeat spin': entry.status === 'running',
                      'bi-check-circle-fill': entry.status === 'done',
                      'bi-x-circle': entry.status === 'failed',
                      'bi-dash-circle': entry.status === 'cancelled',
                    }"
                  ></i>
                  {{ entry.label }} {{ index + 1 }}
                </li>
              </ul>
              <div class="ga-render-actions">
                <button
                  type="button"
                  class="ga-cancel"
                  :class="{ 'is-cancelling': cancelling }"
                  :disabled="cancelling"
                  :aria-busy="cancelling"
                  @click="cancelGeneration()"
                >
                  <span class="ga-cancel-icon"><i class="bi" :class="cancelling ? 'bi-arrow-repeat spin' : 'bi-stop-fill'"></i></span>
                  <span><strong>{{ cancelling ? '正在停止' : '停止生成' }}</strong><small>{{ cancelling ? '同步任务状态' : '立即终止本次任务' }}</small></span>
                </button>
                <span v-if="!cancelling" class="ga-render-safe"><i class="bi bi-cloud-check"></i>可离开页面</span>
              </div>
            </div>
            <p v-if="deckActive && canvasOutputs.length > 1" class="ga-deck-hint">
              <i class="bi bi-arrows-vertical" aria-hidden="true"></i>滚轮或拖拽循环翻阅 · 点卡片看大图
            </p>
          </div>
          <p v-if="!authStore.isAuthenticated" class="ga-login-hint">
            <i class="bi bi-person-lock"></i>登录后才能生成资产、保留历史记录并发布到广场
          </p>
          <div v-if="error || localError" class="ga-error"><i class="bi bi-exclamation-octagon"></i>{{ localError || error }}</div>

          <div
            class="ga-composer"
            :class="{ 'is-drop': dropActive }"
            data-studio-enter
            @dragover.prevent="dropActive = true"
            @dragleave="dropActive = false"
            @drop.prevent="handleReferenceDrop"
          >
            <div class="ga-composer-ref" :class="{ 'has-image': Boolean(referenceUrl || sourcePreview) }">
              <button type="button" class="ga-composer-ref-pick" title="参考图：拖入 / 粘贴 / 点击上传" @click="fileInput?.click()">
                <AuthenticatedImage v-if="referenceUrl" :src="referenceUrl" alt="参考图" :max-dimension="160" />
                <img v-else-if="sourcePreview" :src="sourcePreview" alt="参考图" />
                <template v-else>
                  <i class="bi bi-image" aria-hidden="true"></i>
                  <span>参考图</span>
                </template>
              </button>
              <button
                v-if="inputFile || referenceUrl"
                type="button"
                class="ga-composer-ref-clear"
                title="移除参考图"
                @click="clearSource"
              >
                <i class="bi bi-x-lg"></i>
              </button>
            </div>
            <div class="ga-composer-main">
              <Transition name="ga-type" mode="out-in">
                <textarea
                  :key="assetType"
                  v-model="currentState.prompt"
                  rows="2"
                  maxlength="1200"
                  :placeholder="currentType.placeholder"
                  @keydown.enter.exact.prevent="!busy && generate()"
                ></textarea>
              </Transition>
              <div class="ga-composer-tools">
                <div class="ga-examples" role="group" aria-label="灵感示例">
                  <button v-for="example in currentType.examples" :key="example.label" type="button" @click="applyExample(example.text)">
                    {{ example.label }}
                  </button>
                </div>
                <button type="button" class="ga-lib-link" @click="openLibrary('prompts')">
                  <i class="bi bi-journal-text" aria-hidden="true"></i>提示词库
                </button>
              </div>
            </div>
            <div class="ga-composer-run">
              <button
                class="ga-generate"
                :class="{ 'is-busy': busy }"
                type="button"
                :disabled="busy"
                :aria-label="busy ? `正在渲染，${costLabel}` : `启动生成，${costLabel}`"
                @click="generate"
              >
                <span class="ga-generate-icon" aria-hidden="true">
                  <i class="bi" :class="busy ? 'bi-stars' : 'bi-play-fill'"></i>
                  <span v-if="busy" class="ga-generate-orbit"></span>
                </span>
                <span class="ga-generate-copy">
                  <span class="ga-generate-action">
                    {{ busy ? '正在渲染' : '启动生成' }}
                    <em v-if="costLabel">预计扣费</em>
                    <span v-if="busy" class="ga-generate-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  </span>
                  <span v-if="costLabel" class="ga-generate-price">
                    <strong>{{ costDisplay.price }}</strong>
                    <small v-if="costDisplay.detail">{{ costDisplay.detail }}</small>
                  </span>
                </span>
                <span class="ga-generate-trailing" aria-hidden="true">
                  <span v-if="busy" class="ga-generate-live"><i></i>LIVE</span>
                  <kbd v-else>↵</kbd>
                </span>
                <span v-if="busy" class="ga-generate-track" aria-hidden="true"><i></i></span>
              </button>
            </div>
          </div>

          <input ref="fileInput" hidden type="file" accept="image/*" @change="chooseFile" />
        </section>

        <aside class="ga-console" data-studio-enter>
          <div class="ga-console-title"><span>GENERATOR</span><em>{{ currentType.en }}</em></div>

          <div class="ga-console-body">
            <Transition name="ga-type" mode="out-in">
              <div :key="assetType" class="ga-type-section">
                <details
                  v-for="group in currentControlGroups"
                  :key="group.id"
                  class="ga-control-group"
                  :open="group.id === currentControlGroups[0]?.id"
                >
                  <summary class="ga-sec">
                    <b>{{ group.number }}</b><span>{{ group.label }}</span>
                    <em>{{ group.selects.length + group.toggles.length }}</em>
                    <i class="bi bi-chevron-down" aria-hidden="true"></i>
                  </summary>
                  <div class="ga-sec-body">
                    <div v-for="select in group.selects" :key="select.key" class="ga-field">
                      <span class="ga-field-label">{{ select.label }}</span>
                      <div class="ga-chiprow" role="group" :aria-label="select.label">
                        <button
                          v-for="option in select.options"
                          :key="option.id"
                          type="button"
                          :class="{ 'is-on': currentState.selects[select.key] === option.id }"
                          :title="option.prompt"
                          @click="currentState.selects[select.key] = option.id"
                        >
                          {{ option.label }}
                        </button>
                      </div>
                    </div>

                    <div v-if="group.toggles.length" class="ga-toggles">
                      <button
                        v-for="toggle in group.toggles"
                        :key="toggle.key"
                        type="button"
                        :class="{ 'is-on': currentState.toggles[toggle.key] }"
                        :title="toggle.prompt"
                        role="switch"
                        :aria-checked="currentState.toggles[toggle.key]"
                        @click="currentState.toggles[toggle.key] = !currentState.toggles[toggle.key]"
                      >
                        <span class="ga-toggle-copy">
                          <i class="bi" :class="toggle.icon || 'bi-toggle2-off'" aria-hidden="true"></i>{{ toggle.label }}
                        </span>
                        <span class="ga-mini-switch" aria-hidden="true"><span></span></span>
                      </button>
                    </div>

                    <div v-if="group.output" class="ga-pair">
                      <div class="ga-field">
                        <span class="ga-field-label">输出比例</span>
                        <div class="ga-chiprow" role="group" aria-label="输出比例">
                          <button
                            v-for="ratio in currentType.aspects"
                            :key="ratio"
                            type="button"
                            :class="{ 'is-on': currentState.aspect === ratio }"
                            @click="currentState.aspect = ratio"
                          >
                            {{ ratio }}
                          </button>
                        </div>
                      </div>
                      <div class="ga-field">
                        <span class="ga-field-label">生成数量</span>
                        <div class="ga-chiprow" role="group" aria-label="生成数量">
                          <button
                            v-for="count in [1, 2, 3, 4]"
                            :key="count"
                            type="button"
                            :class="{ 'is-on': imageCount === count }"
                            @click="imageCount = count"
                          >
                            {{ count }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            </Transition>

            <div class="ga-sec"><b>{{ styleSectionNumber }}</b><span>美术风格</span></div>
            <div class="ga-sec-body">
              <div class="ga-stylegrid" role="group" aria-label="美术风格">
                <button
                  v-for="option in STYLE_OPTIONS"
                  :key="option.id"
                  type="button"
                  :class="{ 'is-on': style === option.id }"
                  :title="option.prompt"
                  @click="style = option.id"
                >
                  <span class="ga-swatch" :style="{ background: option.swatch }" aria-hidden="true"></span>
                  <span>{{ option.label }}</span>
                </button>
              </div>
              <p class="ga-style-hint">{{ currentStyle.prompt }}</p>
            </div>

            <div class="ga-sec"><b>{{ qualitySectionNumber }}</b><span>质量控制</span></div>
            <div class="ga-sec-body">
              <details><summary>负面约束<i class="bi bi-chevron-down"></i></summary><textarea v-model="negative" rows="3"></textarea></details>
            </div>
          </div>

          <div class="ga-console-foot">
            <button class="ga-quality" type="button" :class="{ off: !hdMode }" @click="hdMode = !hdMode">
              <span><i class="bi bi-badge-hd"></i><strong>高清生产模式</strong></span>
              <em>{{ hdMode ? 'ON' : 'OFF' }}</em>
            </button>
          </div>
        </aside>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="ga-drawer">
        <div v-if="libraryOpen" class="ga-drawer-backdrop" @click.self="libraryOpen = false">
          <aside class="ga-drawer" role="dialog" aria-modal="true" aria-label="资产库">
            <header>
              <div class="ga-drawer-tabs" role="tablist">
                <button type="button" :class="{ 'is-on': libraryTab === 'prompts' }" @click="switchLibraryTab('prompts')">
                  <i class="bi bi-journal-text"></i>词库
                </button>
                <button type="button" :class="{ 'is-on': libraryTab === 'history' }" @click="switchLibraryTab('history')">
                  <i class="bi bi-clock-history"></i>历史记录
                </button>
                <button type="button" :class="{ 'is-on': libraryTab === 'published' }" @click="switchLibraryTab('published')">
                  <i class="bi bi-broadcast"></i>我的资产
                </button>
              </div>
              <button type="button" class="ga-drawer-close" aria-label="关闭资产库" @click="libraryOpen = false">
                <i class="bi bi-x-lg"></i>
              </button>
            </header>

            <div v-if="libraryTab === 'prompts'" class="ga-drawer-body">
              <div class="ga-prompt-search">
                <i class="bi bi-search" aria-hidden="true"></i>
                <input v-model="promptQuery" type="search" placeholder="搜索提示词…" aria-label="搜索提示词" />
              </div>
              <p v-if="promptLoading && !promptItems.length" class="ga-drawer-note"><i class="bi bi-arrow-repeat spin"></i>正在载入词库…</p>
              <p v-else-if="!promptItems.length" class="ga-drawer-note">提示词库暂时为空，管理员分配后会显示在这里</p>
              <p v-else-if="!filteredPrompts.length" class="ga-drawer-note">没有匹配「{{ promptQuery }}」的提示词</p>
              <div v-else class="ga-prompt-list">
                <button v-for="item in filteredPrompts" :key="item.id" type="button" class="ga-prompt-item" @click="usePromptEntry(item)">
                  <span class="ga-prompt-cover">
                    <AuthenticatedImage
                      v-if="item.coverUrl || item.imageUrl"
                      :src="item.coverUrl || item.imageUrl"
                      alt=""
                      :max-dimension="360"
                      loading="lazy"
                    />
                    <i v-else class="bi bi-controller" aria-hidden="true"></i>
                  </span>
                  <span class="ga-prompt-copy">
                    <strong v-if="item.title">{{ item.title }}</strong>
                    <span>{{ item.prompt }}</span>
                    <em><i class="bi bi-stars" aria-hidden="true"></i>点击填入创意描述</em>
                  </span>
                </button>
                <button v-if="promptHasMore" type="button" class="ga-prompt-more" :disabled="promptLoading" @click="loadPromptEntries(false)">
                  <i class="bi" :class="promptLoading ? 'bi-arrow-repeat spin' : 'bi-chevron-down'" aria-hidden="true"></i>
                  {{ promptLoading ? '载入中…' : '加载更多' }}
                </button>
              </div>
            </div>

            <div v-else-if="libraryTab === 'history'" class="ga-drawer-body">
              <div v-if="legacyOutputs.length" class="ga-history-filter" role="group" aria-label="历史筛选">
                <button type="button" :class="{ 'is-on': historyFilter === 'all' }" @click="historyFilter = 'all'">
                  全部 {{ outputs.length }}
                </button>
                <button type="button" :class="{ 'is-on': historyFilter === 'legacy' }" @click="historyFilter = 'legacy'">
                  <i class="bi bi-archive" aria-hidden="true"></i>早期作品 {{ legacyOutputs.length }}
                </button>
              </div>
              <p v-if="historyLoading && !outputs.length" class="ga-drawer-note"><i class="bi bi-arrow-repeat spin"></i>正在载入历史…</p>
              <p v-else-if="!outputs.length" class="ga-drawer-note">还没有生成记录，先去生成一张吧</p>
              <div v-else class="ga-drawer-grid">
                <article v-for="output in libraryHistoryOutputs" :key="output" class="ga-shelf-item is-history">
                  <button type="button" class="ga-shelf-pick" @click="pickFromLibrary(output)">
                    <AuthenticatedImage :src="output" alt="" :max-dimension="480" />
                    <span class="ga-shelf-kind">{{ outputTypeLabel(output) }}</span>
                  </button>
                  <footer>
                    <button type="button" title="以它为参考" @click="useOutputAsReference(output)"><i class="bi bi-pin-angle"></i></button>
                    <button type="button" title="发布到广场" :disabled="!outputJobIds[output]" @click="openPublish(output)">
                      <i class="bi bi-broadcast"></i>
                    </button>
                    <button type="button" title="下载" @click="downloadOutput(output)"><i class="bi bi-download"></i></button>
                    <button
                      type="button"
                      :class="{ 'is-armed': pendingDeleteUrl === output }"
                      :title="pendingDeleteUrl === output ? '再点一次确认删除' : '删除'"
                      @click="requestDeleteOutput(output)"
                    >
                      <i class="bi" :class="pendingDeleteUrl === output ? 'bi-question-lg' : 'bi-trash3'"></i>
                    </button>
                  </footer>
                </article>
              </div>
              <button
                v-if="historyHasMore"
                type="button"
                class="ga-prompt-more ga-history-more"
                :disabled="historyLoading"
                @click="loadMoreHistory()"
              >
                <i class="bi" :class="historyLoading ? 'bi-arrow-repeat spin' : 'bi-chevron-down'" aria-hidden="true"></i>
                {{ historyLoading ? '载入中…' : '加载更多历史' }}
              </button>
            </div>

            <div v-else class="ga-drawer-body">
              <p v-if="assetsLoading" class="ga-drawer-note"><i class="bi bi-arrow-repeat spin"></i>正在载入我的资产…</p>
              <p v-else-if="!authStore.isAuthenticated" class="ga-drawer-note">登录后可查看我的资产：发布到广场的作品会集中显示在这里</p>
              <p v-else-if="!myAssets.length" class="ga-drawer-note">还没有发布过作品：生成后点「发布到广场」，审核通过就会出现在这里</p>
              <div v-else class="ga-drawer-grid">
                <article v-for="asset in myAssets" :key="asset.id" class="ga-shelf-item is-asset">
                  <div class="ga-shelf-pick">
                    <AuthenticatedImage :src="asset.resultUrl" :alt="asset.title" :max-dimension="480" loading="lazy" />
                    <span class="ga-asset-status" :data-status="asset.status">{{ assetStatusLabel(asset.status) }}</span>
                  </div>
                  <footer class="is-meta">
                    <strong :title="asset.title">{{ asset.title }}</strong>
                    <small>{{ new Date(asset.updatedAt || asset.createdAt).toLocaleDateString() }}</small>
                  </footer>
                </article>
              </div>
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>

    <WallevenImagePreview
      :open="fullscreenOpen"
      :images="fullscreenOutputs"
      :current-src="activeOutput"
      :title="currentTypeHeading"
      :filename="`game-${assetType}.png`"
      :metadata="{ id: outputJobIds[activeOutput] || activeOutput, category: currentType.label, ratio: currentState.aspect, style: currentStyle.label }"
      @close="fullscreenOpen = false"
      @select="openFullscreen"
    />

    <SharePublishDialog
      :open="publishOpen"
      :title="`${currentType.label} · ${currentState.prompt.slice(0, 24)}`"
      :style-label="currentStyle.label"
      :default-category="currentType.shareCategory"
      :suggested-tags="['游戏美术', currentType.label]"
      :submitting="submittingShare"
      @close="publishOpen = false"
      @submit="submitPublish"
    />

    <InsufficientCreditsDialog
      :show="creditsPrompt.dialogOpen.value"
      :required="creditsPrompt.requiredCredits.value"
      :available="creditsPrompt.availableCredits.value"
      @close="creditsPrompt.closePrompt"
    />
  </main>
</template>

<style scoped>
.game-art-studio{--acid:#b8ff35;--cyan:#35dcff;--panel:#17191c;min-height:calc(100vh - var(--app-header-offset,64px));display:grid;grid-template-columns:86px 1fr;background:#0d0f11;color:#f6f7f7;font-family:Inter,"PingFang SC",sans-serif;letter-spacing:0}.ga-rail{border-right:1px solid #2c3034;display:flex;flex-direction:column;align-items:center;padding:14px 8px;gap:5px}.ga-rail button{width:68px;height:58px;border:0;border-left:3px solid transparent;background:transparent;color:#777;display:grid;place-items:center;align-content:center;gap:4px;cursor:pointer}.ga-rail button i{font-size:18px}.ga-rail button span{font-size:9px}.ga-rail button.active{color:var(--acid);background:#1b201b;border-color:var(--acid)}.ga-rail .ga-library{margin-top:auto}.ga-main{min-width:0}.ga-workspace{display:grid;grid-template-columns:minmax(0,1fr) 350px;grid-template-rows:minmax(0,1fr);min-height:calc(100vh - var(--app-header-offset,64px))}.ga-canvas{padding:16px 22px;min-width:0;display:flex;flex-direction:column}.ga-canvas-head{min-height:34px;display:flex;align-items:center;justify-content:space-between;gap:12px;font:700 9px/1 monospace;color:#686e73;padding-bottom:10px}.ga-canvas-title{display:flex;align-items:baseline;gap:12px;min-width:0}.ga-canvas-title strong{font-size:15px;color:#eef1f2;letter-spacing:.04em;white-space:nowrap}.ga-canvas-status{display:flex;align-items:center;gap:7px;color:#777;white-space:nowrap}.ga-canvas-status i{width:6px;height:6px;border-radius:50%;background:#5ecf7a}.ga-canvas-status.working{color:var(--acid)}.ga-canvas-status.working i{background:var(--acid);box-shadow:0 0 10px var(--acid)}.ga-canvas-head button{border:0;background:transparent;color:#777;cursor:pointer;padding:0 5px;font-size:13px}.ga-canvas-head button:disabled{opacity:.35;cursor:not-allowed}.ga-output{position:relative;flex:1;min-height:360px;border:1px solid #272c31;background-color:#101215;background-image:linear-gradient(#171a1e 1px,transparent 1px),linear-gradient(90deg,#171a1e 1px,transparent 1px);background-size:44px 44px;display:grid;place-items:center;overflow:hidden}.ga-empty{display:grid;place-items:center;gap:8px;color:#757c82;padding:0 8%}.ga-empty strong{color:#a5abb0;font-size:12px}.ga-empty span{font-size:9px;text-align:center;line-height:1.6}.ga-crosshair{width:100px;height:100px;border:1px solid #333a3f;border-radius:50%;display:grid;place-items:center;position:relative}.ga-crosshair::before,.ga-crosshair::after{content:"";position:absolute;background:#333a3f}.ga-crosshair::before{width:140px;height:1px}.ga-crosshair::after{height:140px;width:1px}.ga-crosshair i{font-size:35px;color:var(--acid)}.ga-render{position:absolute;inset:0;background:#0d0f11e8;display:grid;place-items:center;align-content:center;gap:10px}.ga-render strong{font-size:12px;color:var(--acid)}.ga-render small{font-size:9px;color:#666}.ga-loader{width:56px;height:56px;border:2px solid #303630;border-top-color:var(--acid);border-radius:50%;animation:spin 1s linear infinite}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.ga-error{padding:10px 12px;margin-top:8px;border-radius:8px;background:#431f22;color:#ff9a9a;font-size:11px}.ga-console{border-left:1px solid #2c3034;background:var(--panel);display:flex;flex-direction:column;min-height:0;max-height:calc(100vh - var(--app-header-offset,64px));position:sticky;top:var(--app-header-offset,64px);overflow:hidden}.ga-console-title{display:flex;justify-content:space-between;align-items:center;flex:0 0 auto;padding:13px 20px 11px;border-bottom:1px solid #30353a;font:700 10px/1 monospace}.ga-console-title span{color:var(--acid)}.ga-console-title em{color:#666;font-style:normal}.ga-console-body{flex:1;min-height:0;overflow-y:auto;padding:0 20px 18px;scrollbar-width:thin}.ga-console-foot{flex:0 0 auto;padding:13px 20px 15px;border-top:1px solid #30353a;background:#131518}.ga-field{display:block;min-width:0;font-size:10px;color:#8b9298;margin-top:12px}.ga-field-label{display:block;font-size:10px;color:#8b9298;letter-spacing:.06em}.ga-console textarea,.ga-console select{display:block;width:100%;box-sizing:border-box;margin-top:7px;border:1px solid #363b40;background:#101214;color:#e9ebec;padding:9px;font:11px/1.55 inherit}.ga-console select{height:38px;padding:0 8px}.ga-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}.ga-pair .ga-field{margin-top:12px}.ga-console details{margin-top:12px;border:1px solid #30353a;border-radius:8px;background:#101214;padding:0;overflow:hidden}.ga-console summary{font-size:10px;color:#8b9298;display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:10px 11px;list-style:none}.ga-console summary::-webkit-details-marker{display:none}.ga-console details[open] summary{border-bottom:1px solid #30353a}.ga-console details textarea{margin:0;border:0;background:transparent}.ga-generate{height:46px;border:0;background:var(--acid);color:#111;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 16px;font-size:11px;font-weight:800;white-space:nowrap;cursor:pointer}.ga-generate kbd{font:8px/1 monospace;border:1px solid #5d7e26;padding:4px}.ga-rail button,.ga-console textarea,.ga-console select,.ga-generate{border-radius:8px}.ga-output{border-radius:12px}@media(max-width:900px){.game-art-studio{grid-template-columns:1fr}.ga-rail{position:relative;z-index:20;height:64px;flex-direction:row;overflow:auto;background:#0d0f11;border-right:0;border-bottom:1px solid #2c3034;padding:5px}.ga-rail button{width:60px;height:50px;flex:0 0 auto}.ga-rail .ga-library{margin:0 0 0 auto}.ga-workspace{grid-template-columns:1fr;height:auto;min-height:0}.ga-canvas{height:auto}.ga-output{min-height:320px;max-height:56vh}.ga-model-pick select{max-width:120px}.ga-console{border-left:0;border-top:1px solid #2c3034;position:static;max-height:none;overflow:visible}.ga-console-body{overflow:visible;padding-bottom:14px}}@media(max-width:560px){.ga-canvas{padding:12px}.ga-output{min-height:260px}.ga-console-title{padding:14px 16px 12px}.ga-console-body{padding:0 16px 12px}.ga-console-foot{padding:12px 16px 14px}.ga-workspace{min-height:0}}
.game-art-studio{position:relative;isolation:isolate;overflow:hidden}.ga-rail button{transition:color .2s ease,background .2s ease}.ga-rail button:hover{color:var(--acid)}.ga-canvas-head button{transition:color .2s ease}.ga-canvas-head button:hover:not(:disabled){color:var(--acid)}.ga-canvas-head button.active{color:var(--acid)}.ga-canvas-title strong{border-left:3px solid var(--acid);padding-left:10px}.ga-output.grid-off{background-image:none}.ga-output::before{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background:radial-gradient(130% 105% at 50% 38%,transparent 55%,#00000052 100%)}.ga-empty{position:relative;z-index:1}.ga-render{z-index:3;backdrop-filter:blur(9px)}.ga-loader{position:relative}.ga-loader::after{content:"";position:absolute;inset:10px;border:1px solid var(--cyan);border-radius:50%;animation:spin .65s linear infinite reverse}.ga-console{background:linear-gradient(180deg,#191c1f,#141518);box-shadow:inset 1px 0 0 #ffffff08}.ga-console-foot{box-shadow:0 -12px 22px #0000004d}.ga-generate{background:linear-gradient(180deg,#c6fd52,#a9e832);box-shadow:0 10px 26px #b8ff3520;transition:filter .2s ease}.ga-generate:hover:not(:disabled){filter:brightness(1.07)}@media(prefers-reduced-motion:reduce){.ga-rail button,.ga-generate{transition:none}}

/* ---------- 类型切换动画 ---------- */
.ga-type-enter-active,
.ga-type-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.ga-type-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.ga-type-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ---------- 词库 ---------- */
.ga-history-more {
  width: 100%;
  margin-top: 12px;
}

.ga-lib-link {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: transparent;
  color: #8a9197;
  font-size: 9.5px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ga-lib-link:hover {
  border-color: var(--acid);
  color: var(--acid);
}

.ga-prompt-search {
  position: relative;
  margin-bottom: 12px;
}

.ga-prompt-search i {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #666;
  font-size: 11px;
  pointer-events: none;
}

.ga-prompt-search input {
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px 0 29px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #e9ebec;
  font-size: 11px;
  outline: none;
  transition: border-color 0.15s ease;
}

.ga-prompt-search input:focus {
  border-color: var(--acid);
}

.ga-prompt-list {
  display: grid;
  gap: 8px;
}

.ga-prompt-item {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 5px;
  padding: 10px 11px;
  border: 1px solid #30353a;
  border-radius: 8px;
  background: #101214;
  color: #e9ebec;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.ga-prompt-cover {
  display: grid;
  width: 72px;
  min-height: 76px;
  place-items: center;
  overflow: hidden;
  border: 1px solid #30383b;
  border-radius: 7px;
  color: var(--acid);
  background:
    radial-gradient(circle at 24% 20%, rgba(184, 255, 53, 0.24), transparent 48%),
    linear-gradient(145deg, #1f2521, #0d1010);
}

.ga-prompt-cover :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ga-prompt-cover > i {
  font-size: 24px;
}

.ga-prompt-copy {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.ga-prompt-item:hover {
  transform: translateY(-1px);
  border-color: var(--acid);
  background: #1b201b;
}

.ga-prompt-item strong {
  font-size: 11px;
}

.ga-prompt-copy > span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  color: #9aa1a7;
  font-size: 10.5px;
  line-height: 1.55;
}

.ga-prompt-item em {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--acid);
  font-size: 9px;
  font-style: normal;
  font-weight: 700;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.ga-prompt-item:hover em {
  opacity: 1;
}

.ga-prompt-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  border: 1px dashed #3c4247;
  border-radius: 8px;
  background: transparent;
  color: #8a9197;
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ga-prompt-more:hover:not(:disabled) {
  border-color: var(--acid);
  color: var(--acid);
}

/* ---------- 分组标题（常显，不折叠） ---------- */
.ga-sec {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 0 0 8px;
  border-bottom: 1px solid #24282c;
}

.ga-type-section > .ga-sec:first-child {
  margin-top: 14px;
}

.ga-sec b {
  font: 800 10px/1 monospace;
  color: var(--acid);
}

.ga-sec span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #ced3d7;
}

.ga-sec-body {
  min-width: 0;
}

.ga-console .ga-control-group {
  margin: 0;
  padding: 0;
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.ga-console .ga-control-group > summary.ga-sec {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 8px;
  margin-top: 0;
  padding: 12px 0 9px;
  border-bottom: 1px solid #24282c;
  color: inherit;
  list-style: none;
}

.ga-console .ga-control-group > summary.ga-sec::-webkit-details-marker {
  display: none;
}

.ga-control-group > summary.ga-sec > em {
  display: grid;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  place-items: center;
  border-radius: 5px;
  background: #252a2e;
  color: #737b80;
  font: 700 8px/1 monospace;
  font-style: normal;
}

.ga-control-group > summary.ga-sec > i {
  color: #646c71;
  font-size: 9px;
  transition: transform 0.2s ease, color 0.2s ease;
}

.ga-control-group[open] > summary.ga-sec > i {
  color: var(--acid);
  transform: rotate(180deg);
}

.ga-control-group[open] > summary.ga-sec > em {
  background: #b8ff3511;
  color: #9dcf43;
}

.ga-control-group > .ga-sec-body {
  padding-bottom: 5px;
}

.ga-control-group:not([open]) > summary.ga-sec:hover span {
  color: #fff;
}

.ga-style-hint {
  margin: 8px 0 0;
  font-size: 10px;
  line-height: 1.6;
  color: #6d747a;
}

/* 风格视觉卡片：色板示意气质，选中亮青柠描边 */
.ga-stylegrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  margin-top: 12px;
}

.ga-stylegrid button {
  display: grid;
  gap: 6px;
  padding: 6px 6px 7px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #9aa1a7;
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.ga-stylegrid button:hover {
  border-color: #4a5157;
  color: #d7dbde;
  transform: translateY(-1px);
}

.ga-stylegrid button.is-on {
  border-color: var(--acid);
  color: var(--acid);
  background: #b8ff350d;
}

.ga-swatch {
  display: block;
  height: 30px;
  border-radius: 5px;
  box-shadow: inset 0 0 0 1px #ffffff14;
}

/* 空画布灵感卡片：点一下直接填入描述 */
.ga-inspo {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  width: min(560px, 92%);
  margin-top: 6px;
}

.ga-inspo button {
  display: grid;
  gap: 6px;
  padding: 11px 12px;
  border: 1px solid #2c3237;
  border-radius: 10px;
  background: #14171acc;
  color: #8f969c;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, background 0.15s ease;
}

.ga-inspo button:hover {
  border-color: var(--acid);
  background: #171b16;
  transform: translateY(-2px);
}

.ga-inspo button strong {
  font-size: 11px;
  color: #d3d8db;
}

.ga-inspo button:hover strong {
  color: var(--acid);
}

.ga-inspo button span {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 9.5px;
  line-height: 1.55;
  text-align: left;
}

@media (max-width: 700px) {
  .ga-inspo {
    grid-template-columns: 1fr;
    width: min(420px, 94%);
  }

  .ga-inspo button span {
    -webkit-line-clamp: 1;
  }

  /* 小屏画布高度有限：只保留两张灵感卡，准星缩小防止溢出裁切 */
  .ga-inspo button:nth-child(n + 3) {
    display: none;
  }

  .ga-crosshair {
    width: 72px;
    height: 72px;
  }

  .ga-crosshair i {
    font-size: 26px;
  }
}

.ga-empty em {
  max-width: 420px;
  font-size: 10.5px;
  font-style: normal;
  line-height: 1.7;
  text-align: center;
  color: #8f969c;
}

/* 资产库历史筛选：早期未分类作品收在这里查看 */
.ga-history-filter {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.ga-history-filter button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #9aa1a7;
  font: 700 10px/1 monospace;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ga-history-filter button.is-on {
  border-color: var(--acid);
  background: #1b201b;
  color: var(--acid);
}

.ga-shelf-kind {
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 2;
  padding: 3px 7px;
  border-radius: 6px;
  background: #0d0f11cc;
  color: #c9ced2;
  font: 700 9px/1 monospace;
  letter-spacing: 0.06em;
  backdrop-filter: blur(4px);
}

/* ---------- 控制台组件 ---------- */
.ga-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ga-examples button {
  padding: 5px 10px;
  border: 1px dashed #3c4247;
  border-radius: 8px;
  background: transparent;
  color: #8a9197;
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ga-examples button:hover {
  border-color: var(--acid);
  color: var(--acid);
}

.ga-chiprow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
}

.ga-chiprow button {
  padding: 7px 11px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #9aa1a7;
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ga-chiprow button:hover:not(.is-on) {
  color: #d7dbde;
}

.ga-chiprow button.is-on {
  border-color: var(--acid);
  background: #1b201b;
  color: var(--acid);
}

.ga-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.ga-toggles button {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 144px;
  padding: 7px 11px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #9aa1a7;
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ga-toggle-copy {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.ga-toggle-copy > i {
  font-size: 12px;
}

.ga-toggles button.is-on {
  border-color: var(--acid);
  background: #1b201b;
  color: var(--acid);
}

.ga-mini-switch {
  position: relative;
  width: 28px;
  height: 16px;
  flex: 0 0 auto;
  border: 1px solid #4b5257;
  border-radius: 999px;
  background: #171a1d;
  transition: border-color 0.18s ease, background-color 0.18s ease;
}

.ga-mini-switch > span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #858d92;
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.18s ease;
}

.ga-toggles button.is-on .ga-mini-switch {
  border-color: #b8ff3570;
  background: #b8ff3517;
}

.ga-toggles button.is-on .ga-mini-switch > span {
  background: var(--acid);
  transform: translateX(12px);
}

.ga-quality {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-top: 0;
  padding: 11px 13px;
  border: 0;
  border-left: 2px solid var(--acid);
  border-radius: 8px;
  background: #1e241c;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.ga-quality span {
  display: flex;
  gap: 8px;
  align-items: center;
}

.ga-quality strong {
  font-size: 10px;
}

.ga-quality i,
.ga-quality em {
  color: var(--acid);
}

.ga-quality em {
  font: 700 9px/1 monospace;
  font-style: normal;
}

.ga-quality.off {
  border-left-color: #4a5157;
  background: #191c1f;
}

.ga-quality.off i,
.ga-quality.off em {
  color: #7b8288;
}

.ga-login-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  padding: 9px 12px;
  border: 1px dashed #3c4247;
  border-radius: 8px;
  color: #8a9197;
  font: 700 10px/1.5 monospace;
}

.ga-login-hint i {
  color: var(--acid);
}

/* ---------- 渲染进度与取消 ---------- */
.ga-render {
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 24px;
  background:
    linear-gradient(180deg, #101316f5, #0d1012fa),
    #0d0f11;
  backdrop-filter: none;
}

.ga-render-stage {
  position: relative;
  display: grid;
  width: 150px;
  height: 150px;
  place-items: center;
  isolation: isolate;
}

.ga-render-stage::before,
.ga-render-stage::after {
  position: absolute;
  content: '';
  pointer-events: none;
}

.ga-render-stage::before {
  inset: 8px;
  border: 1px solid #ffffff0a;
  border-radius: 50%;
  box-shadow: inset 0 0 0 22px #ffffff03;
}

.ga-render-stage::after {
  width: 1px;
  height: 100%;
  background: linear-gradient(transparent, #b8ff351c 35%, #b8ff351c 65%, transparent);
}

.ga-signal-sweep {
  position: absolute;
  inset: 15px;
  border-radius: 50%;
  background: conic-gradient(from 0deg, transparent 0 76%, #b8ff3505 84%, #b8ff352b 96%, transparent);
  will-change: transform;
}

.ga-signal-orbit {
  position: absolute;
  border-radius: 50%;
  will-change: transform;
}

.ga-signal-orbit.is-outer {
  inset: 16px;
  border: 1px dashed #64706475;
}

.ga-signal-orbit.is-inner {
  inset: 39px;
  border: 1px solid #35dcff42;
}

.ga-signal-orbit > i {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--acid);
  box-shadow: 0 0 10px #b8ff357a;
}

.ga-signal-orbit.is-outer > i:nth-child(1) { top: -3px; left: 50%; }
.ga-signal-orbit.is-outer > i:nth-child(2) { right: 8px; bottom: 18px; width: 3px; height: 3px; }
.ga-signal-orbit.is-outer > i:nth-child(3) { bottom: 9px; left: 17px; width: 3px; height: 3px; background: var(--cyan); }
.ga-signal-orbit.is-inner > i:nth-child(1) { top: 8px; right: 4px; width: 4px; height: 4px; background: var(--cyan); }
.ga-signal-orbit.is-inner > i:nth-child(2) { bottom: 5px; left: 10px; width: 3px; height: 3px; }

.ga-signal-wave {
  position: absolute;
  width: 48px;
  height: 48px;
  border: 1px solid #b8ff3559;
  border-radius: 50%;
  opacity: 0.72;
  will-change: transform, opacity;
}

.ga-signal-wave.is-two { opacity: 0.42; }
.ga-signal-wave.is-three { opacity: 0.2; }

.ga-signal-core {
  position: relative;
  z-index: 2;
  display: flex;
  width: 54px;
  height: 54px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid #b8ff355c;
  border-radius: 12px;
  background: #111812;
  color: var(--acid);
  box-shadow: inset 0 0 20px #b8ff350b, 0 0 24px #0009;
}

.ga-signal-core > i {
  font-size: 15px;
}

.ga-signal-bars {
  display: flex;
  height: 15px;
  align-items: flex-end;
  gap: 2px;
}

.ga-signal-bar {
  display: block;
  width: 2px;
  height: 14px;
  border-radius: 2px;
  background: var(--acid);
  will-change: transform;
}

.ga-render-copy {
  display: grid;
  place-items: center;
  gap: 8px;
  text-align: center;
}

.ga-render-live {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #7c8580;
  font: 750 8px/1 monospace;
  letter-spacing: 0.12em;
}

.ga-render-live > i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--acid);
  box-shadow: 0 0 8px #b8ff356b;
}

.ga-render-copy > strong {
  max-width: min(440px, 80vw);
  color: #eef2ee;
  font-size: 15px;
  line-height: 1.35;
}

.ga-render-copy > small {
  color: #707873;
  font-size: 9px;
}

.ga-progress {
  display: flex;
  max-width: min(420px, 82vw);
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  max-height: 86px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: thin;
}

.ga-progress li {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid #343a3e;
  border-radius: 7px;
  background: #111416;
  font: 650 9px/1.4 monospace;
  color: #8a9197;
}

.ga-progress li.is-running {
  border-color: #b8ff3547;
  color: #fff;
}

.ga-progress li.is-done {
  border-color: #b8ff352e;
  color: var(--acid);
}

.ga-progress li.is-failed {
  color: #ff9a9a;
}

.ga-progress li.is-cancelled {
  color: #666;
}

.ga-render-actions {
  display: flex;
  align-items: center;
  gap: 13px;
}

.ga-cancel {
  display: grid;
  grid-template-columns: 34px auto;
  align-items: center;
  gap: 9px;
  min-width: 156px;
  height: 48px;
  padding: 0 13px 0 7px;
  border: 1px solid #4a5054;
  border-radius: 10px;
  background: #15181a;
  color: #e9ecea;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    transform 0.18s ease;
}

.ga-cancel-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 7px;
  background: #ffffff08;
  color: #aeb5b1;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.ga-cancel > span:last-child {
  display: grid;
  gap: 4px;
}

.ga-cancel strong {
  color: inherit;
  font: 750 10px/1 inherit;
}

.ga-cancel small {
  color: #747c77;
  font: 600 7.5px/1 inherit;
}

.ga-cancel:hover:not(:disabled) {
  border-color: #e06b6b8f;
  background: #211718;
  transform: translateY(-1px);
}

.ga-cancel:hover:not(:disabled) .ga-cancel-icon {
  background: #d9515123;
  color: #ff8585;
}

.ga-cancel:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}

.ga-cancel:focus-visible {
  outline: 2px solid #ff7777;
  outline-offset: 3px;
}

.ga-cancel:disabled {
  cursor: wait;
}

.ga-cancel.is-cancelling {
  border-color: #b8ff3545;
  color: var(--acid);
}

.ga-render-safe {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #6f7772;
  font: 650 8px/1 monospace;
  white-space: nowrap;
}

.ga-render-safe > i {
  color: #859184;
  font-size: 11px;
}

@media (max-width: 560px) {
  .ga-render {
    gap: 13px;
    padding: 16px;
  }

  .ga-render-stage {
    width: 116px;
    height: 116px;
  }

  .ga-signal-orbit.is-outer { inset: 9px; }
  .ga-signal-orbit.is-inner { inset: 29px; }
  .ga-signal-sweep { inset: 8px; }
  .ga-render-safe { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .ga-signal-orbit,
  .ga-signal-sweep,
  .ga-signal-wave,
  .ga-signal-bar {
    will-change: auto;
  }
}

/* ---------- 结果卡片：贴合图片比例，居中排布，无黑边 ---------- */
.ga-results {
  position: absolute;
  inset: 16px;
  z-index: 1;
  container-type: size;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: center;
  align-items: center;
  gap: 14px;
}

/* 卡片宽度 = min(列宽上限, 行高上限 × 图片比例)，高度由 aspect-ratio 推出，永不变形 */
.ga-card {
  --rowh: 100cqh;
  --maxw: 100cqw;
  position: relative;
  width: min(var(--maxw), calc(var(--rowh) * var(--car, 0.75)));
  aspect-ratio: var(--car, 0.75);
  border: 1px solid #2c3238;
  border-radius: 12px;
  background: #0e1013;
  overflow: hidden;
  box-shadow: 0 18px 40px #00000055;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.ga-results[data-count='2'] .ga-card {
  --maxw: calc(50cqw - 7px);
}

.ga-results[data-count='3'] .ga-card {
  --maxw: calc(33.3cqw - 10px);
}

.ga-results[data-count='4'] .ga-card {
  --rowh: calc(50cqh - 7px);
  --maxw: calc(50cqw - 7px);
}

/* ---------- 3D 透视堆叠（进入画布有成图时）：卡片隧道 + 景深 + 视差 ---------- */
.ga-output.is-deck {
  cursor: grab;
  touch-action: none;
}

.ga-output.is-deck:active,
.ga-results.is-deck-dragging {
  cursor: grabbing;
}

.ga-deck-fx {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

/* 氛围层不用运行时 filter（大面积 blur 逐帧渲染很贵），柔度全部烘进渐变 */
.ga-deck-orb {
  position: absolute;
  left: calc(12% + var(--o) * 11%);
  top: calc(18% + (var(--o) % 3) * 22%);
  width: calc(14px + (var(--o) % 4) * 8px);
  height: calc(14px + (var(--o) % 4) * 8px);
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #f5ffe8cc, #b8ff3566 34%, #b8ff3522 58%, transparent 78%);
  opacity: 0.4;
  animation: ga-deck-float calc(7s + var(--o) * 0.7s) ease-in-out infinite;
  animation-delay: calc(var(--o) * -0.8s);
  will-change: transform;
}

.ga-deck-ribbon {
  position: absolute;
  left: -10%;
  right: -10%;
  top: 28%;
  height: 42%;
  background:
    radial-gradient(55% 80% at 50% 40%, #b8ff350e 0%, #b8ff3506 45%, transparent 72%),
    linear-gradient(115deg, transparent 24%, #ffffff05 42%, #ffffff08 50%, #ffffff05 58%, transparent 76%);
  opacity: 0.7;
  transform: rotate(-8deg);
  animation: ga-deck-ribbon 11s ease-in-out infinite;
  will-change: transform, opacity;
}

@keyframes ga-deck-float {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(8px, -14px, 0) scale(1.08);
  }
}

@keyframes ga-deck-ribbon {
  0%,
  100% {
    transform: rotate(-8deg) translateY(0);
    opacity: 0.55;
  }
  50% {
    transform: rotate(-4deg) translateY(10px);
    opacity: 0.85;
  }
}

.ga-results.is-deck {
  display: grid;
  place-items: center;
  perspective: 950px;
  perspective-origin: 50% 84%;
  /* 不用 preserve-3d：配合卡片 3D 旋转会破坏 Chromium 命中测试（hover/点击失灵），
     堆叠层级由每张卡的 z-index 控制，视觉效果不变 */
  container-type: size;
  inset: 4px 16px 40px;
}

.ga-results.is-deck .ga-card {
  --maxw: min(360px, 50cqw);
  --rowh: min(500px, 80cqh);
  grid-area: 1 / 1;
  width: min(var(--maxw), calc(var(--rowh) * var(--car, 0.75)));
  transform: translate3d(0, var(--deck-y, 0), var(--deck-z, 0))
    rotateX(calc(var(--deck-rx, 8deg) + var(--tilt-y, 0deg)))
    rotateY(var(--tilt-x, 0deg))
    rotateZ(var(--deck-rz, 0deg))
    scale(var(--deck-scale, 1));
  opacity: var(--deck-opacity, 1);
  box-shadow: 0 24px 50px #00000080, 0 0 0 1px #ffffff10;
  /* 关键：基础卡片带 transform 过渡，逐帧驱动时会每帧重启过渡导致拖影卡顿 */
  transition: none;
  will-change: transform, opacity;
  pointer-events: none;
}

/* 后卡压暗：走遮罩透明度（可合成），不再用 filter: brightness 逐帧重绘 */
.ga-results.is-deck .ga-card::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: #05070a;
  opacity: var(--deck-dim, 0);
  pointer-events: none;
}

/* 待机浮动：整叠错峰轻浮（独立 translate 属性，不与 3D 定位 transform 冲突） */
.ga-results.is-deck.is-deck-entered .ga-card {
  animation: ga-deck-bob 5.6s ease-in-out infinite;
  animation-delay: calc(var(--i, 0) * -1.4s);
}

.ga-results.is-deck-dragging .ga-card {
  animation-play-state: paused;
}

@keyframes ga-deck-bob {
  0%,
  100% {
    translate: 0 0;
  }

  50% {
    translate: 0 -6px;
  }
}

.ga-results.is-deck .ga-card.is-front {
  pointer-events: auto;
  border-color: #b8ff3566;
  box-shadow:
    0 32px 70px #00000099,
    0 0 0 1px #b8ff3540,
    0 0 48px #b8ff3524;
  transition: scale 0.32s cubic-bezier(0.2, 0.8, 0.3, 1), box-shadow 0.32s ease;
}

/* hover 上浮：前卡放大压近镜头 + 辉光增强（scale 独立属性叠加在 3D 定位之上） */
.ga-results.is-deck.is-deck-entered .ga-card.is-front:hover {
  scale: 1.04;
  box-shadow:
    0 42px 86px #000000b3,
    0 0 0 1px #b8ff3573,
    0 0 62px #b8ff3536;
}

.ga-results.is-deck .ga-card:hover {
  transform: translate3d(0, var(--deck-y, 0), var(--deck-z, 0))
    rotateX(calc(var(--deck-rx, 8deg) + var(--tilt-y, 0deg)))
    rotateY(var(--tilt-x, 0deg))
    rotateZ(var(--deck-rz, 0deg))
    scale(var(--deck-scale, 1));
}

.ga-results.is-deck .ga-pop-enter-active,
.ga-results.is-deck .ga-pop-leave-active {
  animation: none;
  transition: none;
}

.ga-results.is-deck .ga-card-actions {
  opacity: 0;
  pointer-events: none;
}

.ga-results.is-deck .ga-card.is-front:hover .ga-card-actions,
.ga-results.is-deck .ga-card.is-front:focus-within .ga-card-actions {
  opacity: 1;
  transform: translate(-50%, 0);
  pointer-events: auto;
}

.ga-deck-hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 10px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 0;
  color: #6d747a;
  font: 700 10px/1 monospace;
  letter-spacing: 0.08em;
  pointer-events: none;
}

.ga-deck-hint i {
  color: var(--acid);
  opacity: 0.75;
}

@media (max-width: 700px) {
  .ga-results.is-deck {
    inset: 8px 10px 40px;
  }

  .ga-results.is-deck .ga-card {
    --maxw: min(300px, 84cqw);
    --rowh: min(430px, 88cqh);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ga-deck-orb,
  .ga-deck-ribbon,
  .ga-results.is-deck.is-deck-entered .ga-card {
    animation: none;
  }
}

.ga-card:hover {
  border-color: #b8ff3555;
  box-shadow: 0 22px 48px #00000073, 0 0 0 1px #b8ff351f;
  transform: translateY(-2px);
}

.ga-card-view {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}

.ga-card-view :deep(.authenticated-image) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: transparent;
}

.ga-card-actions {
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 2;
  display: flex;
  gap: 7px;
  opacity: 0;
  transform: translate(-50%, 6px) scale(0.98);
  pointer-events: none;
  transition:
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.ga-card:hover .ga-card-actions,
.ga-card:focus-within .ga-card-actions {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
  pointer-events: auto;
}

.ga-card-actions button {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid #ffffff1a;
  border-radius: 50%;
  background: #101316d9;
  color: #c1c6ca;
  box-shadow: 0 5px 16px #0000003d;
  font-size: 13px;
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease,
    transform 0.16s ease;
}

.ga-card-actions button:hover:not(:disabled) {
  border-color: #b8ff3559;
  background: #20252aeb;
  color: var(--acid);
  transform: translateY(-1px);
}

.ga-card-actions button:active:not(:disabled) {
  transform: translateY(0) scale(0.96);
}

.ga-card-actions button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ga-card-actions button.is-armed {
  border-color: #ef6a6a;
  background: #d64545e8;
  color: #fff;
}

@media (hover: none) {
  .ga-card-actions,
  .ga-results.is-deck .ga-card.is-front .ga-card-actions {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
    pointer-events: auto;
  }
}

/* 出错卡片：图像加载失败时渲染故障图形 */
.ga-card-error {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  height: 100%;
  padding: 14px;
  color: #e29a9a;
  background:
    repeating-linear-gradient(45deg, #17111266 0 10px, transparent 10px 20px),
    #120f10;
}

.ga-card-error svg {
  width: 52px;
  height: 52px;
  fill: none;
  stroke: #9c5b5b;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ga-card-error .ga-card-error-slash {
  stroke: #ff6b6b;
  stroke-width: 4;
}

.ga-card-error strong {
  font: 700 10.5px/1 monospace;
  letter-spacing: 0.08em;
}

.ga-card-error-actions {
  display: flex;
  gap: 6px;
}

.ga-card-error-actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  border: 1px solid #5a3a3d;
  border-radius: 8px;
  background: transparent;
  color: #e0a4a4;
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ga-card-error-actions button:hover {
  border-color: #ff6b6b;
  color: #ffb3b3;
}

.ga-card-error-actions button.is-armed {
  border-color: #d64545;
  background: #d64545;
  color: #fff;
}

.ga-card-skeleton {
  display: block;
  border: 1px dashed #2c3238;
  border-radius: 12px;
  background: linear-gradient(110deg, #14171a 30%, #21262b 50%, #14171a 70%);
  background-size: 220% 100%;
  animation: ga-shimmer 1.5s ease-in-out infinite;
}

/* 弹出动效：普通进场（历史回放等）轻翻入即可 */
.ga-pop-enter-active {
  animation: ga-pop-in 0.72s cubic-bezier(0.22, 1.1, 0.32, 1) both;
  animation-delay: calc(var(--i, 0) * 130ms);
}

.ga-pop-leave-active {
  position: absolute;
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.ga-pop-leave-to {
  opacity: 0;
  transform: scale(0.94);
}

@keyframes ga-pop-in {
  0% {
    opacity: 0;
    transform: perspective(1100px) translateY(26px) rotateY(-72deg) scale(0.9);
    filter: brightness(1.9) saturate(1.4);
  }

  60% {
    opacity: 1;
    transform: perspective(1100px) translateY(0) rotateY(9deg) scale(1.015);
    filter: brightness(1.12) saturate(1.1);
  }

  100% {
    opacity: 1;
    transform: none;
    filter: none;
  }
}

/* ---------- 抽卡揭晓（参考实体抽卡）：卡背旋入 → 金色光带下扫擦亮成图 → 边缘闪光 ---------- */
.ga-results.is-fresh .ga-pop-enter-active {
  animation: ga-spin-in 1.05s cubic-bezier(0.16, 0.8, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 200ms);
}

@keyframes ga-spin-in {
  0% {
    opacity: 0;
    transform: perspective(1200px) translateY(42px) rotateY(-520deg) scale(0.5);
  }

  30% {
    opacity: 1;
  }

  100% {
    opacity: 1;
    transform: none;
  }
}

/* 卡背：旋入阶段盖住成图，随光带下扫被逐行擦掉 */
.ga-card-back {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  border-radius: inherit;
  background:
    repeating-linear-gradient(-38deg, #ffffff06 0 2px, transparent 2px 11px),
    radial-gradient(90% 90% at 50% 34%, #1a2418 0%, #0b0e12 74%);
  box-shadow: inset 0 0 0 1px #b8ff3548, inset 0 0 40px #b8ff3512;
  pointer-events: none;
  animation: ga-back-wipe 0.95s cubic-bezier(0.6, 0, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 200ms + 1.2s);
}

.ga-card-back i {
  font-size: clamp(28px, 3.6vw, 44px);
  color: var(--acid);
  text-shadow: 0 0 26px #b8ff3588;
}

.ga-card-back em {
  color: #5f6b60;
  font: 700 9px/1 monospace;
  letter-spacing: 0.4em;
  font-style: normal;
}

@keyframes ga-back-wipe {
  to {
    clip-path: inset(100% 0 0 0);
  }
}

/* 金色光带：与卡背擦除同速自上而下划过 */
.ga-card-sweep {
  position: absolute;
  left: -12%;
  right: -12%;
  top: -18%;
  height: 16%;
  z-index: 4;
  pointer-events: none;
  background: linear-gradient(180deg, transparent, #fff7d894 42%, #ffd76ae0 56%, transparent);
  filter: blur(5px) brightness(1.35);
  opacity: 0;
  animation: ga-sweep-down 0.95s cubic-bezier(0.6, 0, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 200ms + 1.2s);
}

@keyframes ga-sweep-down {
  0% {
    opacity: 0;
    transform: translateY(0);
  }

  12% {
    opacity: 1;
  }

  86% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translateY(760%);
  }
}

/* 揭晓收尾：边缘金色闪光一次 */
.ga-card::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 5;
  border-radius: inherit;
  box-shadow: inset 0 0 0 2px #ffe9a0cc, inset 0 0 36px #ffd76a55;
  opacity: 0;
  pointer-events: none;
}

.ga-results.is-fresh .ga-card::after {
  animation: ga-rim-flash 0.9s ease-out both;
  animation-delay: calc(var(--i, 0) * 200ms + 1.95s);
}

@keyframes ga-rim-flash {
  0% {
    opacity: 0;
  }

  25% {
    opacity: 1;
  }

  100% {
    opacity: 0;
  }
}

@media (max-width: 700px) {
  .ga-results {
    gap: 10px;
  }

  .ga-results[data-count='3'] .ga-card,
  .ga-results[data-count='4'] .ga-card {
    --rowh: calc(50cqh - 5px);
    --maxw: calc(50cqw - 5px);
  }

  .ga-card-error svg {
    width: 40px;
    height: 40px;
  }
}

/* ---------- 画布顶部的模型切换 ---------- */
.ga-canvas-tools {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ga-model-pick {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-right: 8px;
  padding: 0 10px;
  height: 30px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #14171a;
  transition: border-color 0.15s ease;
}

.ga-model-pick:hover,
.ga-model-pick:focus-within {
  border-color: var(--acid);
}

.ga-model-pick > i {
  font-size: 12px;
  color: var(--acid);
}

.ga-model-pick select {
  max-width: 190px;
  border: 0;
  background: transparent;
  color: #d7dbde;
  font: 700 10px/1 inherit;
  cursor: pointer;
  outline: none;
}

.ga-model-pick select option {
  background: #14171a;
  color: #d7dbde;
}

/* ---------- 画布底部的创作条 ---------- */
.ga-composer {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: stretch;
  margin-top: 12px;
  padding: 10px;
  border: 1px solid #2c3238;
  border-radius: 14px;
  background: linear-gradient(180deg, #16191d, #121417);
  box-shadow: 0 14px 32px #00000047, inset 0 1px 0 #ffffff08;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.ga-composer:focus-within {
  border-color: #b8ff3566;
  box-shadow: 0 14px 32px #00000047, 0 0 0 3px #b8ff3512, inset 0 1px 0 #ffffff08;
}

.ga-composer.is-drop {
  border-color: var(--acid);
  box-shadow: 0 0 0 3px #b8ff3529;
}

.ga-composer-ref {
  position: relative;
  flex: 0 0 auto;
}

.ga-composer-ref-pick {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 3px;
  width: 66px;
  height: 100%;
  min-height: 66px;
  padding: 4px;
  border: 1px dashed #3c4247;
  border-radius: 10px;
  background: #101214;
  color: #7b8288;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ga-composer-ref-pick:hover {
  border-color: var(--acid);
  color: var(--acid);
  background: #b8ff350a;
}

.ga-composer-ref-pick i {
  font-size: 15px;
}

.ga-composer-ref-pick span {
  font-size: 8.5px;
  font-weight: 700;
}

.ga-composer-ref.has-image .ga-composer-ref-pick {
  padding: 0;
  border-style: solid;
}

.ga-composer-ref.has-image .ga-composer-ref-pick img,
.ga-composer-ref.has-image .ga-composer-ref-pick :deep(.authenticated-image) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ga-composer-ref-clear {
  position: absolute;
  right: -6px;
  top: -6px;
  z-index: 2;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 1px solid #ffffff2e;
  border-radius: 50%;
  background: #0d0f11;
  color: #fff;
  font-size: 9px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.ga-composer-ref-clear:hover {
  border-color: #d64545;
  background: #d64545;
}

.ga-composer-main {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.ga-composer-main textarea {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  background: transparent;
  color: #e9ebec;
  font: 11.5px/1.6 inherit;
  resize: none;
  outline: none;
}

.ga-composer-main textarea::placeholder {
  color: #5d646a;
}

.ga-composer-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ga-composer-tools .ga-examples {
  margin-top: 0;
  overflow: hidden;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.ga-composer-run {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}

.ga-composer-run .ga-generate {
  position: relative;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  min-width: 236px;
  height: 64px;
  padding: 0 13px 0 10px;
  gap: 11px;
  overflow: hidden;
  border: 1px solid #3a4147;
  background: #0f1214;
  color: #f2f4f2;
  box-shadow: inset 0 1px 0 #ffffff0d, 0 8px 20px #0000002e;
  isolation: isolate;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.ga-composer-run .ga-generate:hover:not(:disabled) {
  border-color: #b8ff3570;
  background: #141816;
  box-shadow: inset 0 1px 0 #ffffff12, 0 10px 26px #00000042, 0 0 0 3px #b8ff350b;
  filter: none;
  transform: translateY(-1px);
}

.ga-composer-run .ga-generate:active:not(:disabled) {
  transform: translateY(0) scale(0.985);
}

.ga-composer-run .ga-generate:focus-visible {
  outline: 2px solid var(--acid);
  outline-offset: 3px;
}

.ga-composer-run .ga-generate:disabled {
  cursor: wait;
  opacity: 1;
}

.ga-generate-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid #b8ff353d;
  border-radius: 9px;
  background: #b8ff3510;
  color: var(--acid);
  box-shadow: inset 0 0 14px #b8ff3508;
}

.ga-generate-icon > i {
  position: relative;
  z-index: 1;
  font-size: 14px;
}

.ga-generate-orbit {
  position: absolute;
  inset: 4px;
  border: 1px solid transparent;
  border-top-color: var(--acid);
  border-right-color: #b8ff3540;
  border-radius: 50%;
  animation: ga-generate-orbit 1.2s linear infinite;
}

.ga-generate-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
  text-align: left;
}

.ga-generate-action {
  display: flex;
  align-items: center;
  min-height: 10px;
  color: #aeb4b0;
  font: 750 9.5px/1 inherit;
  line-height: 1;
}

.ga-generate-action > em {
  margin-left: 7px;
  padding-left: 7px;
  border-left: 1px solid #3a413c;
  color: #737b76;
  font: 600 7.5px/1 inherit;
  font-style: normal;
}

.ga-generate-price {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}

.ga-generate-price > strong {
  color: var(--acid);
  font: 850 15px/1 monospace;
  text-shadow: 0 0 14px #b8ff3524;
}

.ga-generate-price > small {
  overflow: hidden;
  color: #858d88;
  font: 600 8px/1.2 monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ga-generate-trailing {
  display: grid;
  min-width: 28px;
  place-items: center end;
}

.ga-generate-trailing kbd {
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  place-items: center;
  border: 1px solid #3d454b;
  border-radius: 6px;
  background: #171b1e;
  color: #7f878c;
  box-shadow: inset 0 -1px 0 #0008;
  font: 700 9px/1 monospace;
}

.ga-generate-live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #b8ff35b8;
  font: 800 7px/1 monospace;
  letter-spacing: 0.08em;
}

.ga-generate-live > i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--acid);
  box-shadow: 0 0 8px #b8ff35cc;
  animation: ga-generate-pulse 1.25s ease-in-out infinite;
}

.ga-generate-dots {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 8px;
  margin-left: 5px;
}

.ga-generate-dots > i {
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: var(--acid);
  animation: ga-generate-dot 1s ease-in-out infinite;
}

.ga-generate-dots > i:nth-child(2) { animation-delay: 0.14s; }
.ga-generate-dots > i:nth-child(3) { animation-delay: 0.28s; }

.ga-composer-run .ga-generate.is-busy {
  border-color: #b8ff3545;
  background: #111612;
  box-shadow: inset 0 1px 0 #ffffff0d, 0 10px 26px #00000038, 0 0 22px #b8ff3509;
}

.ga-generate-track {
  position: absolute;
  right: 10px;
  bottom: 0;
  left: 10px;
  height: 2px;
  overflow: hidden;
  border-radius: 2px 2px 0 0;
  background: #b8ff3517;
}

.ga-generate-track > i {
  display: block;
  width: 38%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, var(--acid) 58%, #e6ffac);
  box-shadow: 0 0 8px #b8ff357d;
  animation: ga-generate-scan 1.55s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

@keyframes ga-generate-orbit {
  to { transform: rotate(360deg); }
}

@keyframes ga-generate-pulse {
  50% { opacity: 0.35; transform: scale(0.72); }
}

@keyframes ga-generate-dot {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

@keyframes ga-generate-scan {
  from { transform: translateX(-110%); }
  to { transform: translateX(285%); }
}

@media (max-width: 700px) {
  .ga-composer {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .ga-composer-run {
    grid-column: 1 / -1;
    grid-template-columns: minmax(0, 1fr);
  }

  .ga-composer-run .ga-generate {
    width: 100%;
    min-width: 0;
    height: 58px;
  }

  .ga-composer-tools .ga-examples button:nth-child(n + 3) {
    display: none;
  }

  .ga-model-pick select {
    max-width: 96px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ga-generate-orbit,
  .ga-generate-live > i,
  .ga-generate-dots > i,
  .ga-generate-track > i {
    animation: none;
  }
}

/* ---------- 资产库抽屉 ---------- */
.ga-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10040;
  background: rgba(5, 6, 8, 0.62);
  backdrop-filter: blur(6px);
}

.ga-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(560px, 94vw);
  display: flex;
  flex-direction: column;
  background: #121417;
  border-left: 1px solid #2c3034;
  box-shadow: -30px 0 80px #000a;
  color: #f6f7f7;
}

.ga-drawer > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #2c3034;
}

.ga-drawer-tabs {
  display: flex;
  gap: 6px;
}

.ga-drawer-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #9aa1a7;
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ga-drawer-tabs button.is-on {
  border-color: var(--acid);
  background: #1b201b;
  color: var(--acid);
}

.ga-drawer-close {
  width: 34px;
  height: 34px;
  border: 1px solid #3c4247;
  border-radius: 8px;
  background: #191c1f;
  color: #fff;
  cursor: pointer;
}

.ga-drawer-close:hover {
  border-color: var(--acid);
  color: var(--acid);
}

.ga-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  scrollbar-width: thin;
}

.ga-drawer-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 0;
  color: #8a9197;
  font-size: 11px;
}

.ga-drawer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.ga-shelf-item {
  border: 1px solid #30353a;
  border-radius: 8px;
  background: #171a1d;
  overflow: hidden;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.ga-shelf-item:hover {
  transform: translateY(-3px);
  border-color: #4a5157;
  box-shadow: 0 10px 30px #000a;
}

.ga-shelf-pick {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 4/3;
  padding: 0;
  border: 0;
  background: #101214;
  cursor: pointer;
}

.ga-shelf-item.is-asset .ga-shelf-pick {
  cursor: default;
}

.ga-shelf-pick :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ga-asset-status {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 3px 7px;
  border-radius: 8px;
  background: #0d0f11d9;
  color: #e8b34c;
  font: 700 9px/1 monospace;
}

.ga-asset-status[data-status='approved'] {
  color: var(--acid);
}

.ga-asset-status[data-status='rejected'] {
  color: #ff9a9a;
}

.ga-shelf-item > footer {
  display: flex;
  justify-content: space-around;
  padding: 7px 6px;
  border-top: 1px solid #24282c;
}

.ga-shelf-item > footer button {
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #8a9197;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.ga-shelf-item > footer button:hover:not(:disabled) {
  background: #24282c;
  color: var(--acid);
}

.ga-shelf-item > footer button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ga-shelf-item > footer button.is-armed {
  background: #d64545;
  color: #fff;
}

.ga-shelf-item > footer.is-meta {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  text-align: left;
}

.ga-shelf-item > footer.is-meta strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ga-shelf-item > footer.is-meta small {
  color: #6d747a;
  font-size: 9px;
}

.ga-drawer-enter-active,
.ga-drawer-leave-active {
  transition: opacity 0.2s ease;
}

.ga-drawer-enter-active .ga-drawer,
.ga-drawer-leave-active .ga-drawer {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.ga-drawer-enter-from,
.ga-drawer-leave-to {
  opacity: 0;
}

.ga-drawer-enter-from .ga-drawer,
.ga-drawer-leave-to .ga-drawer {
  transform: translateX(40px);
}

@keyframes ga-shimmer {
  to {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ga-card-skeleton {
    animation: none;
  }

  .ga-pop-enter-active,
  .ga-results.is-fresh .ga-pop-enter-active,
  .ga-results.is-fresh .ga-card::after {
    animation: none;
  }

  .ga-card-back,
  .ga-card-sweep {
    display: none;
  }

  .ga-type-enter-active,
  .ga-type-leave-active,
  .ga-drawer-enter-active .ga-drawer,
  .ga-drawer-leave-active .ga-drawer,
  .ga-card,
  .ga-shelf-item {
    transition: none;
  }
}
</style>
