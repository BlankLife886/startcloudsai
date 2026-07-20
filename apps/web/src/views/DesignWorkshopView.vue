<script setup>
import { computed, onMounted, ref } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
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
  { id: 'landing', label: '落地页', prompt: '产品落地页：首屏 Hero、卖点分区、客户证言、定价表与页脚' },
  { id: 'dashboard', label: '仪表盘', prompt: '数据仪表盘：侧边导航、KPI 指标卡、趋势图表与明细数据表格' },
  { id: 'ecommerce', label: '电商页面', prompt: '电商页面：商品主图、价格与规格选择、购买按钮、评价与推荐位' },
  { id: 'feed', label: '信息流', prompt: '信息流页面：顶部导航、内容卡片流、互动按钮与底部标签栏' },
  { id: 'auth', label: '登录注册', prompt: '登录/注册页：品牌展示区、表单、第三方登录与协议说明' },
  { id: 'settings', label: '设置页', prompt: '设置页面：分组设置列表、开关与输入控件、账号与危险操作区' },
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
  { label: '健身打卡 App', text: '一款年轻人用的健身打卡 App，首页展示今日训练计划、连续打卡天数、卡路里环形进度和好友动态' },
  { label: 'SaaS 官网', text: '一个面向中小团队的项目协作 SaaS 产品官网，突出任务看板、自动化流程和团队协作三个卖点' },
  { label: '咖啡外卖小程序', text: '精品咖啡外卖点单页面，展示招牌饮品、规格选择（杯型/温度/糖度）、优惠券入口和购物车' },
]

const COUNT_OPTIONS = [1, 2, 3, 4]

const {
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
} = useCreativeImageJob({
  source: 'ui-design-workshop',
  featureKey: 'ai.uiDesign',
  jobKindPrefix: 'ui-design',
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
const activeVersionIndex = computed(() => outputs.value.indexOf(activeOutput.value))
const activeVersionLabel = computed(() =>
  activeVersionIndex.value >= 0 ? `V${outputs.value.length - activeVersionIndex.value}` : '',
)

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
    width: `min(100%, calc((100vh - var(--app-header-offset, 64px) - 250px) * ${ratio}))`,
  }
})

useStudioMotion(studioRoot, activeOutput)

onMounted(() => initialize())

function selectPageType(id) {
  pageTypeId.value = id
}

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

function selectOutput(output) {
  activeOutput.value = output
  mediaError.value = ''
}
</script>

<template>
  <main ref="studioRoot" class="dws" :class="{ 'is-blank': !outputs.length && !running }">
    <div class="dws-shell">
      <aside class="dws-panel" data-studio-enter>
        <header class="dws-panel-head">
          <h1><i class="bi bi-bezier2" aria-hidden="true"></i>UI 设计稿</h1>
          <p>选好载体、结构和风格，AI 直接产出高保真设计稿</p>
        </header>

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
              <small>{{ item.ratio }}</small>
            </button>
          </div>
        </section>

        <section class="dws-block">
          <span class="dws-label">页面类型</span>
          <div class="dws-chips" role="group" aria-label="页面类型">
            <button
              v-for="item in PAGE_TYPE_OPTIONS"
              :key="item.id"
              type="button"
              :class="{ 'is-on': pageTypeId === item.id }"
              :aria-pressed="pageTypeId === item.id"
              :title="item.prompt || '完全按照上方描述生成'"
              @click="selectPageType(item.id)"
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
          <div class="dws-chips" role="group" aria-label="视觉风格">
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

        <section class="dws-block dws-brand-row">
          <div>
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
              <label class="dws-color-custom" :style="{ background: brandColor }" title="自定义主色">
                <input v-model="brandColor" type="color" aria-label="自定义主色" />
                <i class="bi bi-eyedropper" aria-hidden="true"></i>
              </label>
            </div>
          </div>
          <div>
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
              <strong>{{ inputFile?.name }}</strong>
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
          <div>
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
            <i class="bi bi-chevron-down" :class="{ 'is-open': promptPreviewOpen }" aria-hidden="true"></i>
          </summary>
          <pre>{{ assembledPrompt }}</pre>
        </details>

        <p v-if="localError || generationError" class="dws-error" role="alert">
          <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
          {{ localError || generationError }}
        </p>

        <button class="dws-generate" type="button" :disabled="running" @click="generate">
          <i class="bi" :class="running ? 'bi-arrow-repeat spin' : 'bi-stars'" aria-hidden="true"></i>
          {{ running ? status || '生成中…' : hasReference ? '重绘设计稿' : '生成设计稿' }}
        </button>
      </aside>

      <section class="dws-stage" data-studio-enter>
        <header class="dws-stage-head">
          <div class="dws-stage-meta">
            <strong>{{ device.label }} · {{ device.ratio }}</strong>
            <span v-if="activeVersionLabel">{{ activeVersionLabel }}</span>
          </div>
          <div class="dws-stage-actions">
            <button
              type="button"
              :disabled="!activeOutput || running"
              title="以当前版本为基础继续修改"
              @click="iterateFromActive"
            >
              <i class="bi bi-arrow-repeat" aria-hidden="true"></i>迭代此版本
            </button>
            <button
              type="button"
              :disabled="!activeOutput"
              title="查看大图"
              @click="fullscreenOpen = true"
            >
              <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>大图
            </button>
            <button type="button" :disabled="!activeOutput" title="下载设计稿" @click="downloadActive">
              <i class="bi bi-download" aria-hidden="true"></i>下载
            </button>
          </div>
        </header>

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

        <footer v-if="outputs.length || historyLoading" class="dws-versions-wrap" aria-label="历史记录">
          <div class="dws-versions-head">
            <span><i class="bi bi-clock-history" aria-hidden="true"></i>历史记录</span>
            <small v-if="historyLoading">正在载入…</small>
            <small v-else>{{ outputs.length }} 张</small>
          </div>
          <div class="dws-versions">
            <button
              v-for="(output, index) in outputs"
              :key="output"
              type="button"
              :class="{ 'is-on': activeOutput === output }"
              :aria-pressed="activeOutput === output"
              @click="selectOutput(output)"
            >
              <AuthenticatedImage :src="output" alt="" :max-dimension="320" />
              <em>V{{ outputs.length - index }}</em>
            </button>
            <span v-if="historyLoading && !outputs.length" class="dws-versions-skeleton" aria-hidden="true">
              <i></i><i></i><i></i>
            </span>
          </div>
        </footer>
      </section>
    </div>

    <Teleport to="body">
      <Transition name="dws-zoom">
        <div
          v-if="fullscreenOpen && activeOutput"
          class="dws-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="设计稿大图"
          @click.self="fullscreenOpen = false"
        >
          <button type="button" aria-label="关闭大图" @click="fullscreenOpen = false">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
          <AuthenticatedImage :src="activeOutput" alt="UI 设计稿大图" loading="eager" />
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
.dws {
  --dws-bg: #09090c;
  --dws-panel: #121218;
  --dws-field: #16161e;
  --dws-ink: rgba(255, 255, 255, 0.96);
  --dws-muted: rgba(255, 255, 255, 0.62);
  --dws-faint: rgba(255, 255, 255, 0.38);
  --dws-line: rgba(255, 255, 255, 0.08);
  --dws-accent: #6d5cff;
  --dws-accent-soft: rgba(109, 92, 255, 0.16);
  min-height: calc(100vh - var(--app-header-offset, 64px));
  background:
    radial-gradient(1200px 500px at 78% -8%, rgba(109, 92, 255, 0.13), transparent 62%),
    var(--dws-bg);
  color: var(--dws-ink);
}

.dws-shell {
  display: grid;
  grid-template-columns: 384px minmax(0, 1fr);
  gap: 16px;
  width: 100%;
  padding: 16px;
  min-height: calc(100vh - var(--app-header-offset, 64px));
  box-sizing: border-box;
}

/* ---------- 左侧参数面板 ---------- */
.dws-panel {
  overflow-y: auto;
  max-height: calc(100vh - var(--app-header-offset, 64px) - 32px);
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(109, 92, 255, 0.06), transparent 140px),
    var(--dws-panel);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
  scrollbar-width: thin;
}

.dws-panel-head h1 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 1.1rem;
}

.dws-panel-head h1 i {
  color: var(--dws-accent);
}

.dws-panel-head p {
  margin: 6px 0 0;
  color: var(--dws-faint);
  font-size: 0.75rem;
}

.dws-block {
  margin-top: 20px;
}

.dws-label {
  display: block;
  margin-bottom: 8px;
  color: var(--dws-muted);
  font-size: 0.76rem;
  font-weight: 600;
}

.dws-block textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 12px;
  border: 1px solid var(--dws-line);
  border-radius: 13px;
  background: var(--dws-field);
  color: var(--dws-ink);
  font: inherit;
  font-size: 0.83rem;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s ease;
}

.dws-block textarea:focus {
  border-color: rgba(109, 92, 255, 0.65);
}

.dws-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.dws-examples button {
  padding: 5px 10px;
  border: 1px dashed rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: transparent;
  color: var(--dws-faint);
  font-size: 0.7rem;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.dws-examples button:hover {
  border-color: rgba(109, 92, 255, 0.6);
  color: #cdc5ff;
}

.dws-custom-structure {
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  padding: 9px 12px;
  border: 1px solid var(--dws-line);
  border-radius: 11px;
  background: var(--dws-field);
  color: var(--dws-ink);
  font: inherit;
  font-size: 0.8rem;
  outline: none;
  transition: border-color 0.15s ease;
}

.dws-custom-structure:focus {
  border-color: rgba(109, 92, 255, 0.65);
}

.dws-custom-structure::placeholder {
  color: var(--dws-faint);
}

.dws-devices {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 7px;
}

.dws-devices button {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 11px 4px 9px;
  border: 1px solid var(--dws-line);
  border-radius: 13px;
  background: var(--dws-field);
  color: var(--dws-muted);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.dws-devices button i {
  font-size: 1.05rem;
}

.dws-devices button span {
  font-size: 0.7rem;
  white-space: nowrap;
}

.dws-devices button small {
  color: var(--dws-faint);
  font: 600 0.62rem/1 monospace;
}

.dws-devices button.is-on {
  border-color: rgba(109, 92, 255, 0.7);
  background: var(--dws-accent-soft);
  color: #fff;
}

.dws-devices button.is-on small {
  color: #b3a7ff;
}

.dws-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.dws-chips button {
  padding: 7px 12px;
  border: 1px solid var(--dws-line);
  border-radius: 999px;
  background: var(--dws-field);
  color: var(--dws-muted);
  font-size: 0.75rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.dws-chips button:hover {
  color: var(--dws-ink);
}

.dws-chips button.is-on {
  border-color: rgba(109, 92, 255, 0.7);
  background: var(--dws-accent-soft);
  color: #fff;
}

.dws-brand-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 14px;
}

.dws-colors {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.dws-colors button,
.dws-color-custom {
  position: relative;
  width: 26px;
  height: 26px;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.dws-colors button:hover,
.dws-color-custom:hover {
  transform: scale(1.12);
}

.dws-colors button.is-on {
  border-color: #fff;
}

.dws-color-custom {
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.7rem;
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
  gap: 6px;
}

.dws-scheme button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 11px;
  border: 1px solid var(--dws-line);
  border-radius: 10px;
  background: var(--dws-field);
  color: var(--dws-muted);
  font-size: 0.73rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.dws-scheme button.is-on {
  border-color: rgba(109, 92, 255, 0.7);
  background: var(--dws-accent-soft);
  color: #fff;
}

.dws-reference {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 9px;
  border: 1px solid var(--dws-line);
  border-radius: 13px;
  background: var(--dws-field);
}

.dws-reference.is-iteration {
  border-color: rgba(109, 92, 255, 0.45);
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
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-reference span {
  display: block;
  margin-top: 3px;
  color: var(--dws-faint);
  font-size: 0.68rem;
}

.dws-reference > button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: var(--dws-muted);
  cursor: pointer;
}

.dws-reference > button:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.dws-upload {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  min-height: 52px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 13px;
  background: transparent;
  color: var(--dws-muted);
  font-size: 0.76rem;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.dws-upload:hover {
  border-color: rgba(109, 92, 255, 0.6);
  color: #cdc5ff;
}

.dws-run-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.dws-model select {
  width: 100%;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--dws-line);
  border-radius: 11px;
  background: var(--dws-field);
  color: var(--dws-ink);
  font-size: 0.78rem;
  outline: none;
}

.dws-count {
  display: flex;
  gap: 5px;
}

.dws-count button {
  width: 34px;
  height: 38px;
  border: 1px solid var(--dws-line);
  border-radius: 11px;
  background: var(--dws-field);
  color: var(--dws-muted);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.dws-count button.is-on {
  border-color: rgba(109, 92, 255, 0.7);
  background: var(--dws-accent-soft);
  color: #fff;
}

.dws-prompt-preview {
  margin-top: 16px;
  border: 1px solid var(--dws-line);
  border-radius: 13px;
  background: var(--dws-field);
}

.dws-prompt-preview summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  color: var(--dws-faint);
  font-size: 0.72rem;
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
  font-size: 0.7rem;
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

.dws-generate {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  min-height: 48px;
  margin-top: 16px;
  border: 0;
  border-radius: 14px;
  background: linear-gradient(90deg, #6655ff, #8a72ff);
  color: #fff;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(102, 85, 255, 0.35);
  transition: filter 0.15s ease, transform 0.15s ease;
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

/* ---------- 右侧画布 ---------- */
.dws-stage {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  background:
    radial-gradient(900px 420px at 50% 0%, rgba(109, 92, 255, 0.07), transparent 70%),
    radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px) 0 0 / 22px 22px,
    #0c0c11;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.dws-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--dws-line);
  background: rgba(18, 18, 24, 0.72);
  backdrop-filter: blur(10px);
}

.dws-stage-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.dws-stage-meta strong {
  font-size: 0.84rem;
  letter-spacing: 0.02em;
}

.dws-stage-meta span {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--dws-accent-soft);
  color: #c3b8ff;
  font: 700 0.68rem/1 monospace;
}

.dws-stage-actions {
  display: flex;
  gap: 7px;
}

.dws-stage-actions button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--dws-line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--dws-muted);
  font-size: 0.73rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.dws-stage-actions button:hover:not(:disabled) {
  border-color: rgba(109, 92, 255, 0.55);
  background: var(--dws-accent-soft);
  color: #fff;
}

.dws-stage-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dws-canvas {
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 0;
  padding: clamp(18px, 3vw, 42px);
}

.dws-artboard {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  background: #101016;
  box-shadow:
    0 30px 80px rgba(0, 0, 0, 0.6),
    0 6px 26px rgba(109, 92, 255, 0.1),
    0 0 0 1px rgba(255, 255, 255, 0.1);
  overflow: hidden;
  transition: aspect-ratio 0.25s ease, width 0.25s ease;
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
  background:
    linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px) 0 0 / 100% 44px,
    linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px) 0 0 / 44px 100%;
  color: var(--dws-faint);
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
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 12px;
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
  margin: 0 18px 10px;
}

.dws-versions-wrap {
  border-top: 1px solid var(--dws-line);
}

.dws-versions-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 18px 0;
}

.dws-versions-head span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--dws-muted);
  font-size: 0.74rem;
  font-weight: 600;
}

.dws-versions-head small {
  color: var(--dws-faint);
  font-size: 0.68rem;
}

.dws-versions {
  display: flex;
  gap: 10px;
  padding: 10px 18px 16px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.dws-versions-skeleton {
  display: flex;
  gap: 10px;
}

.dws-versions-skeleton i {
  width: 116px;
  height: 74px;
  border-radius: 11px;
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

.dws-versions button {
  position: relative;
  flex: none;
  width: 116px;
  height: 74px;
  padding: 0;
  border: 1.5px solid var(--dws-line);
  border-radius: 11px;
  background: #101016;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.18s ease, transform 0.18s ease;
}

.dws-versions button:hover {
  transform: translateY(-3px);
}

.dws-versions button.is-on {
  border-color: var(--dws-accent);
  box-shadow: 0 0 0 3px rgba(109, 92, 255, 0.22);
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
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(9, 9, 13, 0.8);
  color: #cdc5ff;
  font: 700 0.62rem/1 monospace;
}

/* ---------- 大图预览 ---------- */
.dws-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(3, 3, 8, 0.88);
  backdrop-filter: blur(14px);
}

.dws-fullscreen :deep(.authenticated-image) {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6);
  object-fit: contain;
}

.dws-fullscreen > button {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
  font-size: 1rem;
  cursor: pointer;
}

.dws-fullscreen > button:hover {
  background: rgba(255, 255, 255, 0.18);
}

.dws-zoom-enter-active,
.dws-zoom-leave-active {
  transition: opacity 0.18s ease;
}

.dws-zoom-enter-from,
.dws-zoom-leave-to {
  opacity: 0;
}

/* ---------- 动效 ---------- */
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
  .dws-running-scan,
  .dws-running i,
  .dws-empty-sketch span {
    animation: none;
  }
}

/* ---------- 响应式 ---------- */
@media (max-width: 1080px) {
  .dws-shell {
    grid-template-columns: 1fr;
    padding: 12px;
  }

  .dws-panel {
    max-height: none;
    order: 2;
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
    min-height: 40vh;
  }

  .dws-generate {
    position: static;
  }

  .dws-canvas {
    padding: 16px;
  }

  .dws-devices {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
