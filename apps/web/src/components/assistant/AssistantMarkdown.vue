<script setup>
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'

const props = defineProps({
  content: { type: String, default: '' },
  streaming: { type: Boolean, default: false },
})

const emit = defineEmits(['copied'])
const markdownRoot = ref(null)
let copiedTimer = null

const renderedMarkdown = computed(() =>
  DOMPurify.sanitize(
    marked.parse(props.content, {
      async: false,
      breaks: true,
      gfm: true,
    }),
    { USE_PROFILES: { html: true } },
  ),
)

function codeLanguage(code) {
  const languageClass = [...code.classList].find((name) => name.startsWith('language-'))
  return languageClass ? languageClass.slice(9) : '代码'
}

function decorateMarkdown() {
  nextTick(() => {
    const root = markdownRoot.value
    if (!root) return

    root.querySelectorAll('a').forEach((link) => {
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
    })

    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.dataset.enhanced === 'true') return
      const code = pre.querySelector('code')
      if (!code) return

      const toolbar = document.createElement('div')
      toolbar.className = 'markdown-code-toolbar'

      const language = document.createElement('span')
      language.textContent = codeLanguage(code)

      const copyButton = document.createElement('button')
      copyButton.type = 'button'
      copyButton.dataset.copyCode = 'true'
      copyButton.title = '复制代码'
      copyButton.setAttribute('aria-label', '复制代码')
      copyButton.innerHTML = '<i class="bi bi-copy" aria-hidden="true"></i><span>复制</span>'

      toolbar.append(language, copyButton)
      pre.prepend(toolbar)
      pre.dataset.enhanced = 'true'
    })
  })
}

async function handleMarkdownClick(event) {
  const copyButton = event.target.closest('[data-copy-code]')
  if (!copyButton) return
  const code = copyButton.closest('pre')?.querySelector('code')?.innerText
  if (!code) return

  await navigator.clipboard.writeText(code)
  copyButton.classList.add('is-copied')
  copyButton.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i><span>已复制</span>'
  emit('copied')

  if (copiedTimer) window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => {
    if (!copyButton.isConnected) return
    copyButton.classList.remove('is-copied')
    copyButton.innerHTML = '<i class="bi bi-copy" aria-hidden="true"></i><span>复制</span>'
  }, 1600)
}

onMounted(decorateMarkdown)
onUpdated(decorateMarkdown)
onBeforeUnmount(() => {
  if (copiedTimer) window.clearTimeout(copiedTimer)
})
</script>

<template>
  <div
    ref="markdownRoot"
    class="assistant-markdown"
    :class="{ 'is-streaming': streaming }"
    @click="handleMarkdownClick"
    v-html="renderedMarkdown"
  ></div>
</template>

<style scoped>
.assistant-markdown {
  min-width: 0;
  color: inherit;
  font-size: 14px;
  line-height: 1.68;
  overflow-wrap: anywhere;
}

.assistant-markdown :deep(> :first-child) {
  margin-top: 0;
}

.assistant-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.assistant-markdown :deep(p) {
  margin: 0 0 0.72em;
}

.assistant-markdown :deep(h1),
.assistant-markdown :deep(h2),
.assistant-markdown :deep(h3),
.assistant-markdown :deep(h4) {
  margin: 1.15em 0 0.48em;
  color: var(--assistant-text);
  font-weight: 680;
  line-height: 1.32;
}

.assistant-markdown :deep(h1) {
  font-size: 1.42em;
}

.assistant-markdown :deep(h2) {
  font-size: 1.25em;
}

.assistant-markdown :deep(h3),
.assistant-markdown :deep(h4) {
  font-size: 1.08em;
}

.assistant-markdown :deep(ul),
.assistant-markdown :deep(ol) {
  margin: 0.45em 0 0.8em;
  padding-left: 1.55em;
}

.assistant-markdown :deep(li) {
  margin: 0.24em 0;
  padding-left: 0.12em;
}

.assistant-markdown :deep(li > p) {
  margin-bottom: 0.3em;
}

.assistant-markdown :deep(blockquote) {
  margin: 0.8em 0;
  padding: 0.18em 0 0.18em 0.9em;
  border-left: 3px solid color-mix(in srgb, var(--assistant-accent) 46%, transparent);
  color: var(--assistant-text-soft);
}

.assistant-markdown :deep(blockquote p) {
  margin: 0;
}

.assistant-markdown :deep(a) {
  color: var(--assistant-accent-ink);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 38%, transparent);
  text-underline-offset: 3px;
}

.assistant-markdown :deep(a:hover) {
  text-decoration-color: currentColor;
}

.assistant-markdown :deep(code) {
  padding: 0.16em 0.38em;
  border: 1px solid color-mix(in srgb, var(--assistant-border) 72%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--assistant-panel-active) 76%, transparent);
  font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.88em;
}

.assistant-markdown :deep(pre) {
  position: relative;
  max-width: 100%;
  margin: 0.9em 0;
  padding: 42px 16px 15px;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--assistant-border-strong) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--assistant-panel) 86%, #080a0a);
  line-height: 1.55;
  scrollbar-width: thin;
}

.assistant-markdown :deep(pre code) {
  display: block;
  min-width: max-content;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: var(--assistant-text);
  background: transparent;
  white-space: pre;
}

.assistant-markdown :deep(.markdown-code-toolbar) {
  position: absolute;
  inset: 0 0 auto;
  display: flex;
  height: 34px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 13px;
  border-bottom: 1px solid color-mix(in srgb, var(--assistant-border) 70%, transparent);
  color: var(--assistant-muted);
  background: color-mix(in srgb, var(--assistant-card) 48%, transparent);
  font-family: inherit;
  font-size: 11px;
}

.assistant-markdown :deep(.markdown-code-toolbar button) {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: 0;
  border-radius: 6px;
  color: var(--assistant-text-soft);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.assistant-markdown :deep(.markdown-code-toolbar button:hover),
.assistant-markdown :deep(.markdown-code-toolbar button.is-copied) {
  color: var(--assistant-text);
  background: var(--assistant-panel-hover);
}

.assistant-markdown :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  margin: 0.85em 0;
  overflow-x: auto;
  border-collapse: collapse;
  scrollbar-width: thin;
}

.assistant-markdown :deep(th),
.assistant-markdown :deep(td) {
  min-width: 110px;
  padding: 8px 11px;
  border: 1px solid var(--assistant-border);
  text-align: left;
  vertical-align: top;
}

.assistant-markdown :deep(th) {
  background: color-mix(in srgb, var(--assistant-panel-active) 76%, transparent);
  font-weight: 650;
}

.assistant-markdown :deep(hr) {
  margin: 1.2em 0;
  border: 0;
  border-top: 1px solid var(--assistant-border);
}

.assistant-markdown :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.85em 0;
  border-radius: 8px;
}

.assistant-markdown.is-streaming :deep(> :last-child)::after {
  content: '';
  display: inline-block;
  width: 5px;
  height: 1em;
  margin-left: 3px;
  border-radius: 2px;
  background: var(--assistant-accent);
  vertical-align: -0.12em;
  animation: markdown-caret 0.9s steps(2, end) infinite;
}

@keyframes markdown-caret {
  50% {
    opacity: 0.2;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-markdown.is-streaming :deep(> :last-child)::after {
    animation: none;
  }
}
</style>
