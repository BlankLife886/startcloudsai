<script setup>
import { reactive, ref, watch } from 'vue'
import { getShareOverview } from '@/services/shareGallery'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  styleLabel: { type: String, default: '' },
  defaultCategory: { type: String, default: 'illustration' },
  suggestedTags: { type: Array, default: () => ['AI 染色'] },
  submitting: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'submit'])

const defaultCategories = [
  { value: 'illustration', label: '插画' },
  { value: 'photography', label: '摄影' },
  { value: '3d', label: '3D' },
  { value: 'anime', label: '动漫' },
  { value: 'landscape', label: '风景' },
  { value: 'scifi', label: '科幻' },
  { value: 'other', label: '其他' },
]
const categories = ref(defaultCategories)
const controlledTags = ref([])
let categoriesLoaded = false

const form = reactive({
  title: '',
  description: '',
  category: 'illustration',
  tags: [],
  allowDownload: false,
  allowRemix: false,
  allowRepost: false,
  licenseCode: 'all-rights-reserved',
  publishPrompt: false,
})

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    if (!categoriesLoaded) {
      categoriesLoaded = true
      const data = await getShareOverview().catch(() => null)
      if (Array.isArray(data?.categories) && data.categories.length) {
        categories.value = data.categories.map((item) => ({ value: item.key, label: item.label }))
      }
      controlledTags.value = Array.isArray(data?.tags) ? data.tags.filter((item) => item.enabled !== false) : []
    }
    form.title = props.title || props.styleLabel || 'AI 创作'
    form.description = ''
    form.category = props.defaultCategory || 'illustration'
    const suggested = [props.styleLabel, ...props.suggestedTags]
      .map((label) => controlledTags.value.find((item) => item.label === label)?.label || '')
      .filter(Boolean)
    form.tags = Array.from(new Set(suggested)).slice(0, 8)
    form.allowDownload = false
    form.allowRemix = false
    form.allowRepost = false
    form.licenseCode = 'all-rights-reserved'
    form.publishPrompt = false
  },
  { immediate: true },
)

function submit() {
  emit('submit', {
    ...form,
    title: form.title.trim(),
    description: form.description.trim(),
    tags: form.tags.slice(0, 8),
  })
}

function toggleTag(label) {
  if (form.tags.includes(label)) {
    form.tags = form.tags.filter((item) => item !== label)
    return
  }
  if (form.tags.length >= 8) return
  form.tags = [...form.tags, label]
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="share-publish-backdrop" @click.self="emit('close')">
      <section class="share-publish-dialog" role="dialog" aria-modal="true" aria-label="发布到社区">
        <header><div><span>Publish to Community</span><h2>发布到社区</h2><p>补充作品信息，并决定其他用户可以如何使用它。</p></div><button type="button" aria-label="关闭" @click="emit('close')"><i class="bi bi-x-lg"></i></button></header>
        <div class="share-publish-body">
          <div class="share-publish-form">
            <label class="is-wide"><span>作品标题</span><input v-model="form.title" maxlength="120" placeholder="给作品起一个容易被发现的名字" /></label>
            <label class="is-wide"><span>作品描述</span><textarea v-model="form.description" rows="3" maxlength="600" placeholder="介绍灵感、画面或创作过程（可选）"></textarea></label>
            <div class="share-publish-categories is-wide"><span>作品分类</span><div><button v-for="item in categories" :key="item.value" type="button" :class="{ 'is-selected': form.category === item.value }" @click="form.category = item.value">{{ item.label }}</button></div></div>
            <div class="share-publish-tags is-wide"><span>作品标签</span><div><button v-for="item in controlledTags" :key="item.key" type="button" :class="{ 'is-selected': form.tags.includes(item.label) }" :disabled="!form.tags.includes(item.label) && form.tags.length >= 8" @click="toggleTag(item.label)"># {{ item.label }}</button><small v-if="!controlledTags.length">后台暂未配置可用标签</small></div></div>
          </div>
          <div class="share-publish-controls">
            <label><input v-model="form.allowDownload" type="checkbox" /><span><strong>允许下载生成图</strong><small>公开 AI 生成结果图的下载入口</small></span></label>
            <label><input v-model="form.allowRemix" type="checkbox" /><span><strong>允许二次创作</strong><small>允许其他用户基于作品再创作</small></span></label>
            <label><input v-model="form.allowRepost" type="checkbox" /><span><strong>允许转载</strong><small>转载仍需遵循下方授权协议</small></span></label>
            <label><input v-model="form.publishPrompt" type="checkbox" /><span><strong>公开提示词与生成参数</strong><small>仅公开安全白名单参数，不会公开密钥或服务地址</small></span></label>
          </div>
          <label class="share-publish-license"><span>授权协议</span><select v-model="form.licenseCode"><option value="all-rights-reserved">保留所有权利</option><option value="cc-by">CC BY 署名</option><option value="cc-by-nc">CC BY-NC 署名-非商业</option><option value="cc0">CC0 公共领域</option></select></label>
        </div>
        <footer><button type="button" class="is-secondary" @click="emit('close')">取消</button><button type="button" class="is-primary" :disabled="submitting || !form.title.trim()" @click="submit"><i class="bi" :class="submitting ? 'bi-arrow-repeat spin' : 'bi-send-check'"></i>{{ submitting ? '提交中…' : '提交审核' }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.share-publish-backdrop {
  --share-accent: var(--primary-color, #4caf50);
  --share-accent-rgb: var(--primary-color-rgb, 76, 175, 80);
  --share-page: var(--background-color, var(--bg-color, #060707));
  --share-surface: var(--card-bg-color, #1e1e1e);
  --share-border: var(--border-color, #333);
  --share-hover: var(--hover-color, #2c2c2c);
  --share-text: var(--text-color, #f0f0f0);
  --share-muted: var(--text-muted-color, rgba(240, 240, 240, 0.72));
  position: fixed;
  z-index: 3600;
  inset: 0;
  padding: 20px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--share-page) 76%, transparent);
  backdrop-filter: blur(14px);
}

.share-publish-dialog {
  width: min(680px, 96vw);
  max-height: 92vh;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--share-accent) 18%, var(--share-border));
  border-radius: 22px;
  display: flex;
  flex-direction: column;
  color: var(--share-text);
  background:
    linear-gradient(145deg, rgba(var(--share-accent-rgb), 0.055), transparent 34%),
    color-mix(in srgb, var(--share-surface) 92%, var(--share-page));
  box-shadow:
    0 30px 90px color-mix(in srgb, var(--share-page) 78%, transparent),
    0 0 0 1px rgba(var(--share-accent-rgb), 0.04);
}

.share-publish-dialog > header {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  padding: 22px 24px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--share-accent) 11%, var(--share-border));
  display: flex;
  justify-content: space-between;
  gap: 16px;
  background: color-mix(in srgb, var(--share-surface) 88%, var(--share-page));
  box-shadow: 0 10px 24px color-mix(in srgb, var(--share-page) 34%, transparent);
}

.share-publish-dialog header span {
  color: color-mix(in srgb, var(--share-accent) 82%, var(--share-text));
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.share-publish-dialog h2 {
  margin: 5px 0 3px;
  color: var(--share-text);
  font-size: 24px;
}

.share-publish-dialog p {
  margin: 0;
  color: var(--share-muted);
  font-size: 12px;
}

.share-publish-dialog header button {
  width: 36px;
  height: 36px;
  border: 1px solid color-mix(in srgb, var(--share-text) 9%, transparent);
  border-radius: 50%;
  color: color-mix(in srgb, var(--share-text) 78%, transparent);
  background: color-mix(in srgb, var(--share-hover) 72%, var(--share-surface));
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease;
}

.share-publish-dialog header button:hover {
  border-color: rgba(var(--share-accent-rgb), 0.34);
  color: var(--share-text);
  background: rgba(var(--share-accent-rgb), 0.12);
}

.share-publish-body {
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 22px;
  overscroll-behavior: contain;
  scrollbar-color: rgba(var(--share-accent-rgb), 0.34) transparent;
  scrollbar-gutter: stable;
}

.share-publish-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.share-publish-form label,
.share-publish-license {
  display: grid;
  gap: 6px;
}

.share-publish-form .is-wide { grid-column: 1 / -1; }

.share-publish-form label > span,
.share-publish-license > span,
.share-publish-tags > span,
.share-publish-categories > span {
  color: color-mix(in srgb, var(--share-text) 72%, transparent);
  font-size: 11px;
}

.share-publish-form input,
.share-publish-form textarea,
.share-publish-license select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--share-border) 84%, var(--share-text) 8%);
  border-radius: 10px;
  color: var(--share-text);
  background: color-mix(in srgb, var(--share-surface) 84%, var(--share-page));
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
}

.share-publish-form input::placeholder,
.share-publish-form textarea::placeholder {
  color: color-mix(in srgb, var(--share-muted) 66%, transparent);
}

.share-publish-form input:focus,
.share-publish-form textarea:focus,
.share-publish-license select:focus {
  border-color: rgba(var(--share-accent-rgb), 0.58);
  background: color-mix(in srgb, var(--share-surface) 88%, var(--share-accent) 4%);
  box-shadow: 0 0 0 3px rgba(var(--share-accent-rgb), 0.12);
}

.share-publish-form textarea { resize: vertical; }
.share-publish-license select option { color: var(--share-text); background: var(--share-surface); }
.share-publish-tags,
.share-publish-categories { display: grid; gap: 8px; }
.share-publish-tags > div,
.share-publish-categories > div { display: flex; flex-wrap: wrap; gap: 7px; }

.share-publish-tags button,
.share-publish-categories button {
  min-height: 34px;
  padding: 7px 12px;
  border: 1px solid color-mix(in srgb, var(--share-border) 86%, var(--share-text) 7%);
  border-radius: 999px;
  color: color-mix(in srgb, var(--share-text) 72%, transparent);
  background: color-mix(in srgb, var(--share-surface) 86%, var(--share-page));
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease, transform 0.16s ease;
}

.share-publish-tags button:hover:not(:disabled),
.share-publish-categories button:hover {
  border-color: rgba(var(--share-accent-rgb), 0.48);
  color: var(--share-text);
  background: rgba(var(--share-accent-rgb), 0.09);
  transform: translateY(-1px);
}

.share-publish-tags button.is-selected,
.share-publish-categories button.is-selected {
  border-color: rgba(var(--share-accent-rgb), 0.7);
  color: color-mix(in srgb, var(--share-accent) 42%, var(--share-text));
  background: rgba(var(--share-accent-rgb), 0.2);
  box-shadow: 0 6px 16px rgba(var(--share-accent-rgb), 0.14);
}

.share-publish-tags button:disabled { opacity: 0.35; cursor: not-allowed; }
.share-publish-tags small { color: var(--share-muted); }

.share-publish-controls {
  margin-top: 18px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}

.share-publish-controls label {
  padding: 10px;
  display: flex;
  gap: 9px;
  align-items: flex-start;
  border: 1px solid color-mix(in srgb, var(--share-border) 86%, var(--share-text) 6%);
  border-radius: 11px;
  background: color-mix(in srgb, var(--share-surface) 88%, var(--share-page));
  transition: border-color 0.16s ease, background 0.16s ease;
}

.share-publish-controls label:has(input:checked) {
  border-color: rgba(var(--share-accent-rgb), 0.38);
  background: rgba(var(--share-accent-rgb), 0.075);
}

.share-publish-controls input {
  margin-top: 3px;
  accent-color: var(--share-accent);
}

.share-publish-controls label > span { display: grid; }
.share-publish-controls strong { color: var(--share-text); font-size: 12px; }
.share-publish-controls small { color: var(--share-muted); font-size: 9px; line-height: 1.45; }
.share-publish-license { margin-top: 14px; }

.share-publish-dialog > footer {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  padding: 15px 24px 18px;
  border-top: 1px solid color-mix(in srgb, var(--share-accent) 11%, var(--share-border));
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  background: color-mix(in srgb, var(--share-surface) 90%, var(--share-page));
  box-shadow: 0 -12px 28px color-mix(in srgb, var(--share-page) 36%, transparent);
}

.share-publish-dialog > footer button {
  min-width: 100px;
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}

.share-publish-dialog > footer .is-secondary {
  border: 1px solid color-mix(in srgb, var(--share-border) 76%, var(--share-text) 12%);
  color: color-mix(in srgb, var(--share-text) 76%, transparent);
  background: transparent;
}

.share-publish-dialog > footer .is-secondary:hover {
  border-color: rgba(var(--share-accent-rgb), 0.32);
  color: var(--share-text);
  background: rgba(var(--share-accent-rgb), 0.07);
}

.share-publish-dialog > footer .is-primary {
  border: 1px solid color-mix(in srgb, var(--share-accent) 88%, var(--share-text) 12%);
  color: color-mix(in srgb, var(--share-page) 86%, #000);
  background: linear-gradient(135deg, color-mix(in srgb, var(--share-accent) 84%, #fff 16%), var(--share-accent));
  box-shadow: 0 8px 22px rgba(var(--share-accent-rgb), 0.2);
}

.share-publish-dialog > footer .is-primary:hover:not(:disabled) {
  box-shadow: 0 10px 26px rgba(var(--share-accent-rgb), 0.28);
  transform: translateY(-1px);
}

.share-publish-dialog > footer .is-primary:disabled { opacity: 0.45; cursor: not-allowed; }
.share-publish-dialog > footer i { margin-right: 6px; }

@media (max-width: 620px) {
  .share-publish-backdrop { padding: 10px; }
  .share-publish-dialog { max-height: 96vh; }
  .share-publish-dialog > header { padding: 18px 18px 15px; }
  .share-publish-body { padding: 17px 18px 20px; }
  .share-publish-dialog > footer { padding: 13px 18px 16px; }
  .share-publish-form,
  .share-publish-controls { grid-template-columns: 1fr; }
  .share-publish-form .is-wide { grid-column: auto; }
  .share-publish-dialog > footer button { flex: 1; }
}
</style>
