<script setup>
// UI 设计稿工作台 · 沉浸版
// 布局语言：无边框、填充式控件，层级靠底色深浅与间距；左栏固定节奏直排参数，
// 右侧为无框画布，操作与元信息浮于画布之上；环境光随品牌主色变化。
import { computed, onMounted, ref } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import WallevenImagePreview from '@/components/common/WallevenImagePreview.vue'
import InsufficientCreditsDialog from '@/features/ai-shared/InsufficientCreditsDialog.vue'
import { useCreativeImageJob } from '@/features/creative-studios/useCreativeImageJob'
import { useStudioMotion } from '@/features/creative-studios/useStudioMotion'
import { downloadAuthenticatedMedia } from '@/services/authenticatedMedia'
import { readImageFile } from '@/features/design-workshop/imageWorkshop'

const DEVICE_OPTIONS = [
  {
    id: 'web',
    label: 'Web 网页',
    icon: 'bi-window-fullscreen',
    ratio: '16:9',
    prompt: '桌面端网页界面（1440px 宽度、12 列栅格）',
  },
  {
    id: 'mobile',
    label: '手机 App',
    icon: 'bi-phone',
    ratio: '9:16',
    prompt: '移动端 App 界面（375pt 宽度、含状态栏与底部安全区）',
  },
  {
    id: 'tablet',
    label: '平板',
    icon: 'bi-tablet-landscape',
    ratio: '4:3',
    prompt: '平板端界面（横屏布局、支持双栏结构）',
  },
  {
    id: 'dashboard',
    label: '数据大屏',
    icon: 'bi-bar-chart-line',
    ratio: '16:9',
    prompt: '数据可视化大屏（深色底、全屏图表矩阵布局）',
  },
]

const PAGE_TYPE_OPTIONS = [
  {
    id: 'landing',
    label: '落地页',
    prompt: '产品落地页：首屏 Hero、卖点分区、客户证言、定价表与页脚',
  },
  {
    id: 'dashboard',
    label: '仪表盘',
    prompt: '数据仪表盘：侧边导航、KPI 指标卡、趋势图表与明细数据表格',
  },
  {
    id: 'ecommerce',
    label: '电商页面',
    prompt: '电商页面：商品主图、价格与规格选择、购买按钮、评价与推荐位',
  },
  { id: 'feed', label: '信息流', prompt: '信息流页面：顶部导航、内容卡片流、互动按钮与底部标签栏' },
  { id: 'auth', label: '登录注册', prompt: '登录/注册页：品牌展示区、表单、第三方登录与协议说明' },
  {
    id: 'settings',
    label: '设置页',
    prompt: '设置页面：分组设置列表、开关与输入控件、账号与危险操作区',
  },
  { id: 'profile', label: '个人中心', prompt: '个人中心页：头像资料卡、数据统计、功能入口列表' },
  { id: 'chat', label: '聊天对话', prompt: '即时通讯界面：会话列表、消息气泡、输入框与工具栏' },
  { id: 'onboarding', label: '引导页', prompt: '新用户引导页：主题插画、步骤指示器、行动按钮' },
  { id: 'custom', label: '自定义', prompt: '' },
]

const STYLE_OPTIONS = [
  { id: 'minimal', label: '极简留白', prompt: '极简主义：大量留白、克制配色、精致排版' },
  { id: 'glass', label: '玻璃拟态', prompt: '玻璃拟态：半透明磨砂卡片、柔和渐变背景、细腻高光' },
  { id: 'darkpro', label: '深色专业', prompt: '深色专业：深灰背景、高对比信息层级、克制的强调色' },
  { id: 'vibrant', label: '多彩活力', prompt: '多彩活力：明快渐变、大圆角、活泼插画点缀' },
  { id: 'corporate', label: '商务企业', prompt: '商务企业：稳重蓝灰配色、清晰栅格、正式可信' },
  { id: 'neubrutal', label: '新粗野', prompt: '新粗野主义：粗描边、硬阴影、高饱和撞色色块' },
]

const BRAND_COLORS = [
  '#6d5cff',
  '#2f81f7',
  '#12b76a',
  '#f79009',
  '#f04438',
  '#d444f1',
  '#0e9384',
  '#334155',
]

const BRIEF_EXAMPLES = [
  {
    label: '健身打卡 App',
    text: '一款年轻人用的健身打卡 App，首页展示今日训练计划、连续打卡天数、卡路里环形进度和好友动态',
  },
  {
    label: 'SaaS 官网',
    text: '一个面向中小团队的项目协作 SaaS 产品官网，突出任务看板、自动化流程和团队协作三个卖点',
  },
  {
    label: '咖啡外卖小程序',
    text: '精品咖啡外卖点单页面，展示招牌饮品、规格选择（杯型/温度/糖度）、优惠券入口和购物车',
  },
]

const COUNT_OPTIONS = [1, 2, 3, 4]

const {
  creditsPrompt,
  modelId,
  models,
  status,
  error: generationError,
  running,
  historyLoading,
  outputs,
  activeOutput,
  initialize,
  generate: generateImage,
  formatCostEstimate,
} = useCreativeImageJob({
  source: 'ui-design-workshop',
  featureKey: 'ai.uiDesign',
  jobKindPrefix: 'ui-design',
  preferOriginalOutputs: true,
})

const studioRoot = ref(null)
const fileInput = ref(null)
const brief = ref('')
const deviceId = ref('web')
const pageTypeId = ref('landing')
const customPageType = ref('')
const styleId = ref('minimal')
const brandColor = ref(BRAND_COLORS[0])
const colorScheme = ref('light')
const imageCount = ref(1)
const inputFile = ref(null)
const sourcePreview = ref('')
const iterationSource = ref('')
const localError = ref('')
const mediaError = ref('')
const promptPreviewOpen = ref(false)
const fullscreenOpen = ref(false)

const device = computed(
  () => DEVICE_OPTIONS.find((item) => item.id === deviceId.value) || DEVICE_OPTIONS[0],
)
const pageType = computed(
  () => PAGE_TYPE_OPTIONS.find((item) => item.id === pageTypeId.value) || PAGE_TYPE_OPTIONS[0],
)
const styleOption = computed(
  () => STYLE_OPTIONS.find((item) => item.id === styleId.value) || STYLE_OPTIONS[0],
)
const hasReference = computed(() => Boolean(inputFile.value || iterationSource.value))
const costLabel = computed(() => formatCostEstimate(imageCount.value))
const activeVersionIndex = computed(() => outputs.value.indexOf(activeOutput.value))
const activeVersionLabel = computed(() =>
  activeVersionIndex.value >= 0 ? `V${outputs.value.length - activeVersionIndex.value}` : '',
)

// 环境光随品牌主色变化：只做低透明度的氛围渲染，控件仍使用固定强调色。
const ambientStyle = computed(() => ({ '--dws-brand': brandColor.value }))

const assembledPrompt = computed(() => {
  const lines = []
  const briefText = brief.value.trim()
  if (hasReference.value) {
    lines.push(
      `基于提供的参考界面进行重新设计：${briefText || '在保持信息结构的前提下提升视觉质量'}。`,
    )
  } else {
    lines.push(`为「${briefText || '一款现代数字产品'}」设计一张高保真 UI 设计稿。`)
  }
  lines.push(`设备载体：${device.value.prompt}。`)
  if (pageTypeId.value === 'custom') {
    const custom = customPageType.value.trim()
    if (custom) lines.push(`页面结构：${custom}。`)
  } else if (pageType.value.prompt) {
    lines.push(`页面结构：${pageType.value.prompt}。`)
  }
  lines.push(`视觉风格：${styleOption.value.prompt}。`)
  lines.push(
    `配色：主色 ${brandColor.value}，${colorScheme.value === 'dark' ? '深色' : '浅色'}模式，配套完整的中性色阶。`,
  )
  lines.push(
    '交付标准：真实产品级布局，完整页面（含导航和内容区），清晰的字体层级与 8pt 间距体系，组件风格统一，界面文案使用简洁中文，细节可直接用于开发交付。',
  )
  lines.push(
    '画面要求：整张图就是设计稿本身，铺满画布。不要设备样机外壳、不要透视和倾斜、不要多页拼贴、不要展示设计软件窗口、不要水印。',
  )
  return lines.join('\n')
})

const artboardStyle = computed(() => {
  const [width = 16, height = 9] = device.value.ratio.split(':').map(Number)
  const ratio = width / Math.max(1, height)
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, calc((100vh - var(--app-header-offset, 64px) - 220px) * ${ratio}))`,
  }
})

useStudioMotion(studioRoot, activeOutput)

onMounted(() => initialize())

function applyBriefExample(text) {
  brief.value = text
  localError.value = ''
}

async function chooseFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  inputFile.value = file
  sourcePreview.value = await readImageFile(file)
  iterationSource.value = ''
  localError.value = ''
}

function clearReference() {
  inputFile.value = null
  sourcePreview.value = ''
  iterationSource.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function iterateFromActive() {
  if (!activeOutput.value) return
  iterationSource.value = activeOutput.value
  inputFile.value = null
  sourcePreview.value = ''
  if (fileInput.value) fileInput.value.value = ''
  localError.value = ''
}

function generate() {
  localError.value = ''
  mediaError.value = ''
  if (!brief.value.trim() && !hasReference.value) {
    localError.value = '请先描述产品和页面内容，或导入一张参考界面'
    return
  }
  generateImage({
    prompt: assembledPrompt.value,
    file: inputFile.value,
    sourceUrl: iterationSource.value,
    aspectRatio: device.value.ratio,
    count: imageCount.value,
  })
}

async function downloadActive() {
  if (!activeOutput.value) return
  mediaError.value = ''
  try {
    await downloadAuthenticatedMedia(activeOutput.value, `ui-design-${Date.now()}.png`)
  } catch (caught) {
    mediaError.value = caught?.message || '设计稿下载失败'
  }
}

function selectOutput(output, openPreview = false) {
  activeOutput.value = output
  mediaError.value = ''
  if (openPreview) fullscreenOpen.value = true
}

</script>

<template>
  <main
    ref="studioRoot"
    class="dws"
    :class="{ 'is-blank': !outputs.length && !running }"
    :style="ambientStyle"
  >
    <div class="dws-shell">
      <aside class="dws-panel" data-studio-enter>
        <section class="dws-block">
          <label class="dws-label" for="dws-brief">产品与页面描述</label>
          <textarea
            id="dws-brief"
            v-model="brief"
            rows="4"
            maxlength="1000"
            :placeholder="
              hasReference
                ? '描述要在参考界面基础上修改或强化的内容…'
                : '这是一个什么产品？页面上要有什么内容？'
            "
          ></textarea>
          <div class="dws-examples" role="group" aria-label="灵感示例">
            <button
              v-for="example in BRIEF_EXAMPLES"
              :key="example.label"
              type="button"
              @click="applyBriefExample(example.text)"
            >
              {{ example.label }}
            </button>
          </div>
        </section>

        <section class="dws-block">
          <span class="dws-label">设备载体</span>
          <div class="dws-devices" role="group" aria-label="设备载体">
            <button
              v-for="item in DEVICE_OPTIONS"
              :key="item.id"
              type="button"
              :class="{ 'is-on': deviceId === item.id }"
              :aria-pressed="deviceId === item.id"
              @click="deviceId = item.id"
            >
              <i class="bi" :class="item.icon" aria-hidden="true"></i>
              <span>{{ item.label }}</span>
              <small data-no-translate>{{ item.ratio }}</small>
            </button>
          </div>
        </section>

        <section class="dws-block">
          <span class="dws-label">页面类型</span>
          <div class="dws-grid dws-grid--page" role="group" aria-label="页面类型">
            <button
              v-for="item in PAGE_TYPE_OPTIONS"
              :key="item.id"
              type="button"
              :class="{ 'is-on': pageTypeId === item.id }"
              :aria-pressed="pageTypeId === item.id"
              :title="item.prompt || '完全按照上方描述生成'"
              @click="pageTypeId = item.id"
            >
              {{ item.label }}
            </button>
          </div>
          <input
            v-if="pageTypeId === 'custom'"
            v-model="customPageType"
            class="dws-custom-structure"
            type="text"
            maxlength="120"
            placeholder="描述页面结构，例如：顶部搜索栏 + 左侧筛选 + 卡片瀑布流"
            aria-label="自定义页面结构"
          />
        </section>

        <section class="dws-block">
          <span class="dws-label">视觉风格</span>
          <div class="dws-grid dws-grid--style" role="group" aria-label="视觉风格">
            <button
              v-for="item in STYLE_OPTIONS"
              :key="item.id"
              type="button"
              :class="{ 'is-on': styleId === item.id }"
              :aria-pressed="styleId === item.id"
              :title="item.prompt"
              @click="styleId = item.id"
            >
              {{ item.label }}
            </button>
          </div>
        </section>

        <section class="dws-block dws-color-row">
          <div class="dws-color-brand">
            <span class="dws-label">品牌主色</span>
            <div class="dws-colors" role="group" aria-label="品牌主色">
              <button
                v-for="color in BRAND_COLORS"
                :key="color"
                type="button"
                :class="{ 'is-on': brandColor === color }"
                :style="{ background: color }"
                :aria-label="`主色 ${color}`"
                :aria-pressed="brandColor === color"
                @click="brandColor = color"
              ></button>
              <label
                class="dws-color-custom"
                :style="{ background: brandColor }"
                title="自定义主色"
              >
                <input v-model="brandColor" type="color" aria-label="自定义主色" />
                <i class="bi bi-eyedropper" aria-hidden="true"></i>
              </label>
            </div>
          </div>
          <div class="dws-color-scheme">
            <span class="dws-label">明暗模式</span>
            <div class="dws-scheme" role="group" aria-label="明暗模式">
              <button
                type="button"
                :class="{ 'is-on': colorScheme === 'light' }"
                :aria-pressed="colorScheme === 'light'"
                @click="colorScheme = 'light'"
              >
                <i class="bi bi-sun" aria-hidden="true"></i>浅色
              </button>
              <button
                type="button"
                :class="{ 'is-on': colorScheme === 'dark' }"
                :aria-pressed="colorScheme === 'dark'"
                @click="colorScheme = 'dark'"
              >
                <i class="bi bi-moon-stars" aria-hidden="true"></i>深色
              </button>
            </div>
          </div>
        </section>

        <section class="dws-block">
          <span class="dws-label">参考界面（可选）</span>
          <div v-if="iterationSource" class="dws-reference is-iteration">
            <AuthenticatedImage :src="iterationSource" alt="迭代基准版本" :max-dimension="240" />
            <div>
              <strong>基于 {{ activeVersionLabel || '当前版本' }} 迭代</strong>
              <span>将在此版本基础上按描述修改</span>
            </div>
            <button type="button" aria-label="取消迭代" @click="clearReference">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </div>
          <div v-else-if="sourcePreview" class="dws-reference">
            <img :src="sourcePreview" alt="参考界面预览" />
            <div>
              <strong data-no-translate>{{ inputFile?.name }}</strong>
              <span>将基于此界面重新设计</span>
            </div>
            <button type="button" aria-label="移除参考图" @click="clearReference">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </div>
          <button v-else type="button" class="dws-upload" @click="fileInput?.click()">
            <i class="bi bi-cloud-arrow-up" aria-hidden="true"></i>
            <span>导入界面截图或线框图重绘</span>
          </button>
          <input ref="fileInput" hidden type="file" accept="image/*" @change="chooseFile" />
        </section>

        <section class="dws-block dws-run-row">
          <label class="dws-model">
            <span class="dws-label">生成模型</span>
            <select v-model="modelId">
              <option v-for="model in models" :key="model.id" :value="model.id">
                {{ model.label }}
              </option>
            </select>
          </label>
          <div class="dws-count-wrap">
            <span class="dws-label">数量</span>
            <div class="dws-count" role="group" aria-label="生成数量">
              <button
                v-for="count in COUNT_OPTIONS"
                :key="count"
                type="button"
                :class="{ 'is-on': imageCount === count }"
                :aria-pressed="imageCount === count"
                @click="imageCount = count"
              >
                {{ count }}
              </button>
            </div>
          </div>
        </section>

        <details class="dws-prompt-preview" :open="promptPreviewOpen">
          <summary @click.prevent="promptPreviewOpen = !promptPreviewOpen">
            <i class="bi bi-braces" aria-hidden="true"></i>查看将要发送的完整提示词
            <i
              class="bi bi-chevron-down"
              :class="{ 'is-open': promptPreviewOpen }"
              aria-hidden="true"
            ></i>
          </summary>
          <pre>{{ assembledPrompt }}</pre>
        </details>

        <p v-if="localError || generationError" class="dws-error" role="alert">
          <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
          {{ localError || generationError }}
        </p>

        <div class="dws-generate-dock">
          <button class="dws-generate" type="button" :disabled="running" @click="generate">
            <i
              class="bi"
              :class="running ? 'bi-arrow-repeat spin' : 'bi-stars'"
              aria-hidden="true"
            ></i>
            {{ running ? status || '生成中…' : hasReference ? '重绘设计稿' : '生成设计稿' }}
          </button>
          <p v-if="costLabel" class="dws-cost">{{ costLabel }}</p>
        </div>
      </aside>

      <section class="dws-stage" data-studio-enter>
        <div class="dws-stage-ambient" aria-hidden="true"></div>

        <div class="dws-stage-meta" data-no-translate aria-hidden="true">
          <span>{{ device.label }}</span>
          <b>{{ device.ratio }}</b>
          <em v-if="activeVersionLabel">{{ activeVersionLabel }}</em>
        </div>

        <div class="dws-stage-actions">
          <button
            type="button"
            :disabled="!activeOutput || running"
            title="以当前版本为基础继续修改"
            @click="iterateFromActive"
          >
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i><span>迭代此版本</span>
          </button>
          <button
            type="button"
            :disabled="!activeOutput"
            title="查看大图"
            @click="fullscreenOpen = true"
          >
            <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i><span>大图</span>
          </button>
          <button
            type="button"
            :disabled="!activeOutput"
            title="下载设计稿"
            @click="downloadActive"
          >
            <i class="bi bi-download" aria-hidden="true"></i><span>下载</span>
          </button>
        </div>

        <div class="dws-canvas">
          <div class="dws-artboard" :style="artboardStyle">
            <AuthenticatedImage
              v-if="activeOutput"
              data-studio-output
              :src="activeOutput"
              alt="UI 设计稿预览"
              loading="eager"
              :retry-count="2"
              @error="mediaError = '图片加载失败，请切换版本或重新生成'"
            />
            <div v-else class="dws-empty">
              <div class="dws-empty-sketch" aria-hidden="true">
                <span></span><span></span><span></span>
              </div>
              <strong>画布等待第一稿</strong>
              <span>填好描述与风格，点击「生成设计稿」</span>
            </div>
            <div v-if="running" class="dws-running" aria-live="polite">
              <span class="dws-running-scan" aria-hidden="true"></span>
              <i class="bi bi-stars" aria-hidden="true"></i>
              <strong>{{ status || '正在生成设计稿…' }}</strong>
              <span>通常需要 20 秒到 1 分钟</span>
            </div>
          </div>
        </div>

        <p v-if="mediaError" class="dws-error is-stage" role="alert">{{ mediaError }}</p>

        <footer
          v-if="outputs.length || historyLoading"
          class="dws-versions-wrap"
          aria-label="历史记录"
        >
          <div class="dws-versions">
            <button
              v-for="(output, index) in outputs"
              :key="output"
              type="button"
              :class="{ 'is-on': activeOutput === output }"
              :aria-pressed="activeOutput === output"
              :title="`查看 V${outputs.length - index} 大图`"
              @click="selectOutput(output, true)"
            >
              <AuthenticatedImage :src="output" alt="" :max-dimension="320" />
              <em data-no-translate>V{{ outputs.length - index }}</em>
            </button>
            <span
              v-if="historyLoading && !outputs.length"
              class="dws-versions-skeleton"
              aria-hidden="true"
            >
              <i></i><i></i><i></i>
            </span>
          </div>
        </footer>
      </section>
    </div>

    <WallevenImagePreview
      :open="fullscreenOpen"
      :images="outputs"
      :current-src="activeOutput"
      title="UI 设计稿"
      filename="ui-design.png"
      :metadata="{ id: activeVersionLabel || 'ui-design', category: pageType.label, ratio: device.ratio, style: styleOption.label }"
      @close="fullscreenOpen = false"
      @select="selectOutput"
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
/* ————— 设计令牌：无边框、填充式分层 ————— */
.dws {
  --dws-bg: #0a0a10;
  --dws-brand: #6d5cff;
  --dws-ink: rgba(255, 255, 255, 0.95);
  --dws-muted: rgba(255, 255, 255, 0.6);
  --dws-faint: rgba(255, 255, 255, 0.34);
  --dws-fill: rgba(255, 255, 255, 0.05);
  --dws-fill-hover: rgba(255, 255, 255, 0.09);
  --dws-fill-deep: rgba(255, 255, 255, 0.03);
  --dws-accent: #6d5cff;
  --dws-accent-2: #8a72ff;
  --dws-accent-soft: rgba(109, 92, 255, 0.2);
  --dws-radius: 12px;
  min-height: calc(100vh - var(--app-header-offset, 64px));
  color: var(--dws-ink);
  background:
    radial-gradient(
      1100px 560px at 72% -12%,
      color-mix(in srgb, var(--dws-brand) 13%, transparent),
      transparent 64%
    ),
    radial-gradient(760px 460px at 6% 108%, rgba(109, 92, 255, 0.07), transparent 60%),
    var(--dws-bg);
  transition: background 0.4s ease;
}

.dws-shell {
  display: grid;
  grid-template-columns: 332px minmax(0, 1fr);
  width: 100%;
  height: calc(100vh - var(--app-header-offset, 64px));
  min-height: 620px;
  box-sizing: border-box;
}

/* ————— 左栏：直排参数，统一节奏 ————— */
.dws-panel {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  max-height: 100%;
  padding: 20px 18px 0;
  background: rgba(255, 255, 255, 0.02);
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
}

.dws-panel-head h1 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 1.06rem;
}

.dws-panel-head h1 i {
  color: var(--dws-accent-2);
}

.dws-panel-head p {
  margin: 6px 0 0;
  color: var(--dws-faint);
  font-size: 0.74rem;
}

.dws-block {
  margin-top: 18px;
}

.dws-label {
  display: block;
  margin-bottom: 8px;
  color: var(--dws-faint);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
}

/* 输入类：填充面，无边框，聚焦时才出现强调环 */
.dws-block textarea,
.dws-custom-structure,
.dws-model select {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--dws-radius);
  background: var(--dws-fill);
  color: var(--dws-ink);
  font: inherit;
  outline: none;
  transition:
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.dws-block textarea {
  padding: 12px 13px;
  font-size: 0.83rem;
  line-height: 1.6;
  resize: vertical;
}

.dws-block textarea:hover,
.dws-custom-structure:hover,
.dws-model select:hover {
  background: var(--dws-fill-hover);
}

.dws-block textarea:focus,
.dws-custom-structure:focus,
.dws-model select:focus {
  background: var(--dws-fill-hover);
  box-shadow: 0 0 0 1.5px rgba(109, 92, 255, 0.55);
}

.dws-block textarea::placeholder,
.dws-custom-structure::placeholder {
  color: var(--dws-faint);
}

.dws-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.dws-examples button {
  padding: 5px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dws-faint);
  font-size: 0.7rem;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.dws-examples button:hover {
  background: var(--dws-fill);
  color: #cdc5ff;
}

.dws-custom-structure {
  margin-top: 8px;
  padding: 10px 12px;
  font-size: 0.79rem;
}

/* 选择类：等宽格子，选中为实色强调 */
.dws-devices {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
  padding: 4px;
  border-radius: calc(var(--dws-radius) + 3px);
  background: var(--dws-fill-deep);
}

.dws-devices button {
  display: grid;
  justify-items: center;
  gap: 3px;
  padding: 10px 2px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--dws-muted);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-devices button:hover:not(.is-on) {
  background: var(--dws-fill);
  color: var(--dws-ink);
}

.dws-devices button i {
  font-size: 1rem;
}

.dws-devices button span {
  font-size: 0.68rem;
  white-space: nowrap;
}

.dws-devices button small {
  color: var(--dws-faint);
  font: 600 0.6rem/1 monospace;
}

.dws-devices button.is-on {
  background: var(--dws-accent);
  color: #fff;
  box-shadow: 0 6px 18px rgba(109, 92, 255, 0.35);
}

.dws-devices button.is-on small {
  color: rgba(255, 255, 255, 0.75);
}

.dws-grid {
  display: grid;
  gap: 5px;
  padding: 4px;
  border-radius: calc(var(--dws-radius) + 3px);
  background: var(--dws-fill-deep);
}

.dws-grid--page {
  grid-template-columns: repeat(5, 1fr);
}

.dws-grid--style {
  grid-template-columns: repeat(3, 1fr);
}

.dws-grid button {
  min-height: 32px;
  padding: 0 4px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--dws-muted);
  font-size: 0.72rem;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-grid button:hover:not(.is-on) {
  background: var(--dws-fill);
  color: var(--dws-ink);
}

.dws-grid button.is-on {
  background: var(--dws-accent);
  color: #fff;
  box-shadow: 0 6px 18px rgba(109, 92, 255, 0.35);
}

/* 配色行：主色 + 明暗，同一行两列对齐 */
.dws-color-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
}

.dws-color-brand,
.dws-color-scheme,
.dws-count-wrap {
  min-width: 0;
}

.dws-colors {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
  min-height: 34px;
}

.dws-colors button,
.dws-color-custom {
  position: relative;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.dws-colors button:hover,
.dws-color-custom:hover {
  transform: scale(1.12);
}

.dws-colors button.is-on {
  box-shadow:
    0 0 0 2px var(--dws-bg),
    0 0 0 4px rgba(255, 255, 255, 0.85);
}

.dws-color-custom {
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.66rem;
}

.dws-color-custom input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.dws-scheme {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 11px;
  background: var(--dws-fill-deep);
}

.dws-scheme button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dws-muted);
  font-size: 0.71rem;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-scheme button.is-on {
  background: var(--dws-accent);
  color: #fff;
}

/* 参考界面 */
.dws-reference {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 9px;
  border-radius: var(--dws-radius);
  background: var(--dws-fill);
}

.dws-reference.is-iteration {
  background: var(--dws-accent-soft);
}

.dws-reference img,
.dws-reference :deep(.authenticated-image) {
  width: 56px;
  height: 42px;
  border-radius: 8px;
  object-fit: cover;
}

.dws-reference strong {
  display: block;
  overflow: hidden;
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-reference span {
  display: block;
  margin-top: 3px;
  color: var(--dws-faint);
  font-size: 0.67rem;
}

.dws-reference > button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.07);
  color: var(--dws-muted);
  cursor: pointer;
}

.dws-reference > button:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}

.dws-upload {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  min-height: 48px;
  border: 0;
  border-radius: var(--dws-radius);
  background: var(--dws-fill);
  color: var(--dws-muted);
  font-size: 0.75rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-upload:hover {
  background: var(--dws-fill-hover);
  color: #cdc5ff;
}

/* 模型 + 数量 */
.dws-run-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.dws-model select {
  height: 38px;
  padding: 0 10px;
  font-size: 0.78rem;
}

.dws-count {
  display: grid;
  grid-auto-flow: column;
  gap: 4px;
  padding: 4px;
  border-radius: 11px;
  background: var(--dws-fill-deep);
}

.dws-count button {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dws-muted);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-count button.is-on {
  background: var(--dws-accent);
  color: #fff;
}

/* 提示词预览 */
.dws-prompt-preview {
  margin-top: 16px;
  border-radius: var(--dws-radius);
  background: var(--dws-fill-deep);
}

.dws-prompt-preview summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  color: var(--dws-faint);
  font-size: 0.71rem;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.dws-prompt-preview summary::-webkit-details-marker {
  display: none;
}

.dws-prompt-preview summary .bi-chevron-down {
  margin-left: auto;
  transition: transform 0.2s ease;
}

.dws-prompt-preview summary .bi-chevron-down.is-open {
  transform: rotate(180deg);
}

.dws-prompt-preview pre {
  margin: 0;
  padding: 0 12px 12px;
  color: var(--dws-muted);
  font-size: 0.69rem;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.dws-error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 14px 0 0;
  color: #ff9d9d;
  font-size: 0.74rem;
  line-height: 1.5;
}

/* 生成按钮：吸底渐隐坞 */
.dws-generate-dock {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin: 14px -18px 0;
  padding: 12px 18px 14px;
  background: linear-gradient(180deg, transparent, rgba(10, 10, 16, 0.9) 34%);
}

.dws-generate {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  min-height: 48px;
  border: 0;
  border-radius: 14px;
  background: linear-gradient(90deg, var(--dws-accent), var(--dws-accent-2));
  color: #fff;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(102, 85, 255, 0.35);
  transition:
    filter 0.15s ease,
    transform 0.15s ease;
}

.dws-generate:hover:not(:disabled) {
  filter: brightness(1.08);
}

.dws-generate:active:not(:disabled) {
  transform: scale(0.985);
}

.dws-generate:disabled {
  opacity: 0.65;
  cursor: wait;
}

.dws-cost {
  margin: 8px 0 0;
  text-align: center;
  font-size: 0.72rem;
  color: var(--dws-faint);
}

/* ————— 右侧：无框沉浸画布 ————— */
.dws-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* 画布环境光：跟随品牌主色 */
.dws-stage-ambient {
  pointer-events: none;
  position: absolute;
  inset: 0;
  background: radial-gradient(
    58% 46% at 50% 46%,
    color-mix(in srgb, var(--dws-brand) 9%, transparent),
    transparent 74%
  );
  transition: background 0.4s ease;
}

.dws-stage-meta {
  position: absolute;
  top: 16px;
  left: 20px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 13px;
  border-radius: 999px;
  background: rgba(12, 12, 19, 0.62);
  color: var(--dws-muted);
  font-size: 0.72rem;
  backdrop-filter: blur(10px);
}

.dws-stage-meta b {
  color: var(--dws-faint);
  font: 600 0.66rem/1 monospace;
}

.dws-stage-meta em {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--dws-accent-soft);
  color: #c3b8ff;
  font: 700 0.64rem/1.3 monospace;
}

.dws-stage-actions {
  position: absolute;
  top: 16px;
  right: 20px;
  z-index: 4;
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(12, 12, 19, 0.62);
  backdrop-filter: blur(10px);
}

.dws-stage-actions button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dws-muted);
  font-size: 0.72rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-stage-actions button:hover:not(:disabled) {
  background: var(--dws-accent-soft);
  color: #fff;
}

.dws-stage-actions button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.dws-canvas {
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 0;
  padding: clamp(56px, 7vh, 76px) clamp(20px, 3vw, 44px) 16px;
}

.dws-artboard {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  border-radius: 14px;
  background: #0f0f16;
  box-shadow:
    0 40px 110px rgba(0, 0, 0, 0.62),
    0 10px 34px color-mix(in srgb, var(--dws-brand) 14%, transparent);
  overflow: hidden;
  transition:
    aspect-ratio 0.25s ease,
    width 0.25s ease,
    box-shadow 0.4s ease;
}

.dws-artboard :deep(.authenticated-image) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #0d0d12;
}

.dws-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  color: var(--dws-faint);
  background: radial-gradient(60% 60% at 50% 42%, rgba(255, 255, 255, 0.025), transparent 78%);
}

.dws-empty strong {
  color: var(--dws-muted);
  font-size: 0.94rem;
}

.dws-empty span {
  font-size: 0.74rem;
}

.dws-empty-sketch {
  display: grid;
  gap: 9px;
  width: 148px;
  margin-bottom: 12px;
  padding: 16px;
  border-radius: 12px;
  background: var(--dws-fill-deep);
}

.dws-empty-sketch span {
  height: 11px;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(109, 92, 255, 0.28), rgba(255, 255, 255, 0.07));
  animation: dws-breathe 2.2s ease-in-out infinite;
}

.dws-empty-sketch span:nth-child(1) {
  width: 62%;
}

.dws-empty-sketch span:nth-child(2) {
  width: 100%;
  animation-delay: 0.25s;
}

.dws-empty-sketch span:nth-child(3) {
  width: 82%;
  animation-delay: 0.5s;
}

.dws-running {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  background: rgba(9, 9, 13, 0.72);
  color: #d8d2ff;
  backdrop-filter: blur(5px);
  overflow: hidden;
}

.dws-running i {
  font-size: 1.6rem;
  animation: dws-breathe 1.6s ease-in-out infinite;
}

.dws-running strong {
  font-size: 0.82rem;
}

.dws-running span {
  color: var(--dws-faint);
  font-size: 0.7rem;
}

.dws-running-scan {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(109, 92, 255, 0.14) 48%,
    rgba(109, 92, 255, 0.32) 50%,
    rgba(109, 92, 255, 0.14) 52%,
    transparent 100%
  );
  background-size: 100% 260%;
  animation: dws-scan 2.6s ease-in-out infinite;
}

.dws-error.is-stage {
  position: relative;
  z-index: 4;
  margin: 0 20px 8px;
}

/* 历史：悬浮胶片条，无分隔线 */
.dws-versions-wrap {
  position: relative;
  z-index: 4;
  flex: 0 0 auto;
  padding: 4px 0 14px;
}

.dws-versions {
  display: flex;
  justify-content: safe center;
  gap: 9px;
  padding: 4px 20px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
  mask-image: linear-gradient(90deg, transparent, #000 26px, #000 calc(100% - 26px), transparent);
}

.dws-versions button {
  position: relative;
  flex: none;
  width: 104px;
  height: 66px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: #101016;
  cursor: pointer;
  overflow: hidden;
  opacity: 0.62;
  transition:
    opacity 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.dws-versions button:hover {
  opacity: 1;
  transform: translateY(-3px);
}

.dws-versions button.is-on {
  opacity: 1;
  box-shadow:
    0 0 0 2px var(--dws-accent),
    0 8px 22px rgba(109, 92, 255, 0.3);
}

.dws-versions :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dws-versions em {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(9, 9, 13, 0.78);
  color: #cdc5ff;
  font: 700 0.6rem/1.4 monospace;
}

.dws-versions-skeleton {
  display: flex;
  gap: 9px;
}

.dws-versions-skeleton i {
  width: 104px;
  height: 66px;
  border-radius: 10px;
  background: linear-gradient(
    110deg,
    rgba(255, 255, 255, 0.04) 30%,
    rgba(255, 255, 255, 0.09) 50%,
    rgba(255, 255, 255, 0.04) 70%
  );
  background-size: 220% 100%;
  animation: dws-shimmer 1.5s ease-in-out infinite;
}

@keyframes dws-shimmer {
  to {
    background-position: -120% 0;
  }
}

/* ————— 焦点可见性 ————— */
.dws-devices button:focus-visible,
.dws-grid button:focus-visible,
.dws-scheme button:focus-visible,
.dws-count button:focus-visible,
.dws-colors button:focus-visible,
.dws-examples button:focus-visible,
.dws-upload:focus-visible,
.dws-generate:focus-visible,
.dws-stage-actions button:focus-visible,
.dws-versions button:focus-visible {
  outline: 2px solid var(--dws-accent-2);
  outline-offset: 2px;
}

/* ————— 动效 ————— */
.spin {
  animation: dws-spin 1s linear infinite;
}

@keyframes dws-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes dws-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

@keyframes dws-scan {
  0% {
    background-position: 0 130%;
  }
  100% {
    background-position: 0 -130%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dws,
  .dws-stage-ambient,
  .dws-artboard {
    transition: none;
  }

  .dws-running-scan,
  .dws-running i,
  .dws-empty-sketch span,
  .dws-versions-skeleton i {
    animation: none;
  }

  .dws-versions button:hover {
    transform: none;
  }
}

/* ————— 响应式 ————— */
@media (max-width: 1080px) {
  .dws-shell {
    grid-template-columns: 1fr;
    height: auto;
  }

  .dws-panel {
    max-height: none;
    order: 2;
    padding: 16px 16px 0;
  }

  .dws-stage {
    order: 1;
    min-height: 62vh;
  }

  /* 还没有产出时，小屏先展示参数面板，避免首屏是一块空画布 */
  .dws.is-blank .dws-panel {
    order: 1;
  }

  .dws.is-blank .dws-stage {
    order: 2;
    min-height: 42vh;
  }

  .dws-generate-dock {
    position: static;
    margin: 14px -16px 0;
    padding: 12px 16px 14px;
  }

  .dws-canvas {
    padding-top: 64px;
  }

  .dws-stage-actions button span {
    display: none;
  }

  .dws-stage-actions button {
    padding: 8px 10px;
  }
}

@media (max-width: 560px) {
  .dws-grid--page {
    grid-template-columns: repeat(4, 1fr);
  }

  .dws-color-row {
    grid-template-columns: 1fr;
    gap: 14px;
  }
}
</style>
