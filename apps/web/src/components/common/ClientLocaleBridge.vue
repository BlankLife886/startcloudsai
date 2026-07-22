<script setup>
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useLocaleStore } from '@/stores/locale'
import { translateClientAttribute, translateClientText } from '@/i18n/clientTranslations'

const localeStore = useLocaleStore()
const textSources = new WeakMap()
const textOutputs = new WeakMap()
const attributeSources = new WeakMap()
const attributeOutputs = new WeakMap()
const translatedAttributes = ['placeholder', 'title', 'aria-label']
let observer = null
let scheduled = false
let titleSource = ''
let titleOutput = ''

function shouldSkip(element) {
  if (!element) return true
  return Boolean(
    element.closest(
      'script,style,code,pre,textarea,[contenteditable="true"],[data-no-translate],.notranslate',
    ),
  )
}

function shouldSkipAttributes(element) {
  if (!element) return true
  return Boolean(
    element.closest(
      'script,style,code,pre,[contenteditable="true"],[data-no-translate],.notranslate',
    ),
  )
}

function translateTextNode(node) {
  const parent = node.parentElement
  if (!parent || shouldSkip(parent)) return
  const current = String(node.nodeValue || '')
  if (!current.trim()) return
  if (!textSources.has(node) || current !== textOutputs.get(node)) textSources.set(node, current)
  const source = textSources.get(node) || current
  const translated = translateClientText(source, localeStore.locale)
  textOutputs.set(node, translated)
  if (current !== translated) node.nodeValue = translated
}

function translateAttributes(element) {
  // Text entered in form controls must never be translated, but their static
  // placeholder/title/aria-label still belongs to the surrounding interface.
  if (shouldSkipAttributes(element)) return
  let sources = attributeSources.get(element)
  let outputs = attributeOutputs.get(element)
  if (!sources) {
    sources = new Map()
    outputs = new Map()
    attributeSources.set(element, sources)
    attributeOutputs.set(element, outputs)
  }
  translatedAttributes.forEach((name) => {
    if (!element.hasAttribute(name)) return
    const current = element.getAttribute(name) || ''
    if (!sources.has(name) || current !== outputs.get(name)) sources.set(name, current)
    const translated = translateClientAttribute(sources.get(name), localeStore.locale)
    outputs.set(name, translated)
    if (translated !== current) element.setAttribute(name, translated)
  })
}

function translateTree(root = document.body) {
  if (!root) return
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return
  translateAttributes(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node)
    else translateAttributes(node)
    node = walker.nextNode()
  }
}

function translateDocumentTitle() {
  const current = document.title
  if (!titleSource || current !== titleOutput) titleSource = current
  const translated = translateClientText(titleSource, localeStore.locale)
  titleOutput = translated
  if (translated !== current) document.title = translated
}

function scheduleTranslation() {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    translateTree(document.body)
    translateDocumentTitle()
  })
}

watch(
  () => localeStore.locale,
  async () => {
    localeStore.applyToDocument()
    await nextTick()
    translateTree(document.body)
    translateDocumentTitle()
  },
)

onMounted(() => {
  translateTree(document.body)
  translateDocumentTitle()
  observer = new MutationObserver(scheduleTranslation)
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: translatedAttributes,
  })
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template><span class="client-locale-bridge" aria-hidden="true"></span></template>

<style scoped>
.client-locale-bridge {
  display: none;
}
</style>
