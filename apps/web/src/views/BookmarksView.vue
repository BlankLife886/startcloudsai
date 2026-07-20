<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  dedupeBookmarks,
  downloadTextFile,
  exportBookmarkHtml,
  parseBrowserBookmarkHtml,
  readBookmarkLibrary,
  saveBookmarkLibrary,
  smartClassifyBookmarks,
} from '@/features/bookmarks/bookmarkLibrary'

const items = ref([])
const query = ref('')
const activeCategory = ref('全部')
const selectedId = ref('')
const importInput = ref(null)
const organizing = ref(false)
const notice = ref('')

const categories = computed(() => {
  const counts = new Map()
  items.value.forEach((item) => counts.set(item.category, (counts.get(item.category) || 0) + 1))
  return [{ name: '全部', count: items.value.length }, ...Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)]
})
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return items.value.filter((item) => {
    if (activeCategory.value !== '全部' && item.category !== activeCategory.value) return false
    return !needle || `${item.title} ${item.url} ${item.tags.join(' ')}`.toLowerCase().includes(needle)
  })
})
const selected = computed(() => items.value.find((item) => item.id === selectedId.value) || null)
const duplicateSavings = computed(() => Math.max(0, items.value.length - dedupeBookmarks(items.value).length))

onMounted(() => { items.value = readBookmarkLibrary() })
watch(items, (value) => saveBookmarkLibrary(value), { deep: true })

async function importBookmarks(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const imported = parseBrowserBookmarkHtml(await file.text())
  const before = items.value.length
  items.value = dedupeBookmarks([...items.value, ...imported])
  notice.value = `已导入 ${imported.length} 条，合并后新增 ${items.value.length - before} 条。`
  event.target.value = ''
}

async function organizeAll() {
  if (!items.value.length) return
  organizing.value = true
  notice.value = '正在分析标题、域名与原目录...'
  await new Promise((resolve) => window.setTimeout(resolve, 450))
  items.value = smartClassifyBookmarks(items.value)
  activeCategory.value = '全部'
  organizing.value = false
  notice.value = 'AI 整理完成：已去重、重建分类并补充域名标签。'
}

function updateSelected(key, value) {
  if (!selected.value) return
  items.value = items.value.map((item) => item.id === selected.value.id ? { ...item, [key]: value, updatedAt: new Date().toISOString() } : item)
}

function removeSelected() {
  if (!selected.value) return
  items.value = items.value.filter((item) => item.id !== selected.value.id)
  selectedId.value = ''
}

function exportAll() {
  downloadTextFile(exportBookmarkHtml(items.value), `starcloud-bookmarks-${new Date().toISOString().slice(0, 10)}.html`, 'text/html;charset=utf-8')
}

function bookmarkDomain(item) {
  try { return new URL(item.url).hostname.replace(/^www\./, '') } catch { return '' }
}

function bookmarkInitial(item) {
  return bookmarkDomain(item).slice(0, 1).toUpperCase() || 'B'
}
</script>

<template>
  <main class="bookmark-desk">
    <header class="bookmark-header">
      <div><span>LIBRARY / {{ items.length }}</span><h1>书签管理</h1></div>
      <label class="bookmark-find"><i class="bi bi-search"></i><input v-model="query" type="search" placeholder="搜索名称、网址或标签" /></label>
      <div class="bookmark-actions">
        <input ref="importInput" hidden type="file" accept="text/html,.html" @change="importBookmarks" />
        <button type="button" @click="importInput?.click()"><i class="bi bi-upload"></i>导入浏览器书签</button>
        <button class="primary" type="button" :disabled="organizing || !items.length" @click="organizeAll"><i class="bi bi-stars"></i>{{ organizing ? '整理中' : '一键 AI 整理' }}</button>
        <button class="icon-button" type="button" title="导出书签" :disabled="!items.length" @click="exportAll"><i class="bi bi-download"></i></button>
      </div>
    </header>

    <div v-if="notice" class="bookmark-notice"><i class="bi bi-check2-circle"></i>{{ notice }}<button type="button" title="关闭" @click="notice = ''"><i class="bi bi-x"></i></button></div>

    <section class="bookmark-workspace">
      <aside class="bookmark-sidebar">
        <div class="bookmark-sidebar-title"><span>COLLECTIONS</span><button type="button" title="新建分类"><i class="bi bi-plus"></i></button></div>
        <button v-for="category in categories" :key="category.name" type="button" :class="{ active: activeCategory === category.name }" @click="activeCategory = category.name">
          <i class="bi" :class="category.name === '全部' ? 'bi-inboxes' : 'bi-folder2'"></i><span>{{ category.name }}</span><em>{{ category.count }}</em>
        </button>
        <div class="bookmark-local-note"><i class="bi bi-shield-check"></i><strong>仅本地存储</strong><span>书签文件与网址不会上传服务器</span></div>
      </aside>

      <section class="bookmark-list">
        <div class="bookmark-list-head"><span>{{ activeCategory }}</span><span>{{ filtered.length }} ITEMS</span><span>DOMAIN</span><span>UPDATED</span></div>
        <button v-for="item in filtered" :key="item.id" type="button" :class="['bookmark-row', { active: selectedId === item.id }]" @click="selectedId = item.id">
          <span class="bookmark-favicon">{{ bookmarkInitial(item) }}</span>
          <span class="bookmark-main"><strong>{{ item.title }}</strong><small>{{ item.tags.join(' · ') || '无标签' }}</small></span>
          <span class="bookmark-domain">{{ bookmarkDomain(item) }}</span>
          <time>{{ new Date(item.updatedAt).toLocaleDateString('zh-CN') }}</time>
        </button>
        <div v-if="!filtered.length" class="bookmark-empty"><i class="bi bi-bookmarks"></i><strong>{{ items.length ? '没有匹配的书签' : '导入你的第一份浏览器书签' }}</strong><span>支持 Chrome、Edge、Safari 与 Firefox 导出的 HTML 文件</span></div>
      </section>

      <aside class="bookmark-inspector">
        <template v-if="selected">
          <div class="inspector-heading"><span>DETAILS</span><a :href="selected.url" target="_blank" rel="noopener noreferrer" title="打开书签"><i class="bi bi-box-arrow-up-right"></i></a></div>
          <label>名称<input :value="selected.title" @input="updateSelected('title', $event.target.value)" /></label>
          <label>网址<input :value="selected.url" @input="updateSelected('url', $event.target.value)" /></label>
          <label>分类<input :value="selected.category" list="bookmark-categories" @input="updateSelected('category', $event.target.value)" /></label>
          <datalist id="bookmark-categories"><option v-for="category in categories.slice(1)" :key="category.name" :value="category.name" /></datalist>
          <label>标签<input :value="selected.tags.join(', ')" @change="updateSelected('tags', $event.target.value.split(',').map(v => v.trim()).filter(Boolean))" /></label>
          <div class="inspector-path"><span>原目录</span><strong>{{ selected.folderPath.join(' / ') || '根目录' }}</strong></div>
          <button class="danger" type="button" @click="removeSelected"><i class="bi bi-trash3"></i>删除书签</button>
        </template>
        <div v-else class="inspector-empty"><i class="bi bi-cursor"></i><span>选择一条书签进行编辑</span></div>
      </aside>
    </section>

    <footer class="bookmark-status"><span><i class="bi bi-cloud-check"></i>本地数据已保存</span><span>去重节省 {{ duplicateSavings }} 条</span><span>{{ categories.length - 1 }} 个分类</span></footer>
  </main>
</template>

<style scoped>
.bookmark-desk{--ink:#14211c;--green:#17624b;min-height:calc(100vh - var(--app-header-offset,64px));background:#f6f7f3;color:var(--ink);padding:24px clamp(16px,3vw,44px) 44px;font-family:Inter,"PingFang SC",sans-serif;letter-spacing:0}.bookmark-header{display:grid;grid-template-columns:auto minmax(240px,1fr) auto;gap:30px;align-items:center;border-bottom:1px solid #ccd2cc;padding-bottom:20px}.bookmark-header h1{font-size:30px;margin:4px 0 0}.bookmark-header>div>span,.bookmark-sidebar-title span,.inspector-heading span{font:700 10px/1 monospace;color:#728078}.bookmark-find{height:42px;background:#fff;border:1px solid #d8ddd8;display:flex;align-items:center;gap:10px;padding:0 14px;max-width:620px;width:100%;justify-self:center}.bookmark-find input{border:0;outline:0;min-width:0;flex:1;background:transparent}.bookmark-actions{display:flex;gap:8px}.bookmark-actions button{height:40px;border:1px solid #cbd2cd;background:#fff;color:var(--ink);padding:0 13px;display:flex;align-items:center;gap:7px}.bookmark-actions .primary{background:var(--green);color:#fff;border-color:var(--green)}.bookmark-actions .icon-button{width:40px;padding:0;justify-content:center}.bookmark-notice{margin:14px 0 0;background:#e4f2ea;color:#155b43;padding:10px 13px;display:flex;gap:9px;align-items:center;font-size:13px}.bookmark-notice button{margin-left:auto;background:transparent;border:0}.bookmark-workspace{display:grid;grid-template-columns:210px minmax(420px,1fr) 280px;min-height:620px;border-bottom:1px solid #ccd2cc}.bookmark-sidebar,.bookmark-inspector{padding:22px 18px}.bookmark-sidebar{border-right:1px solid #d7dcd7}.bookmark-inspector{border-left:1px solid #d7dcd7;background:#eef1ed}.bookmark-sidebar-title,.inspector-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}.bookmark-sidebar-title button,.inspector-heading a{border:0;background:transparent;color:inherit;font-size:18px}.bookmark-sidebar>button{width:100%;height:39px;border:0;background:transparent;color:#48554e;display:grid;grid-template-columns:24px 1fr auto;align-items:center;text-align:left;padding:0 8px}.bookmark-sidebar>button.active{background:#dfe9e3;color:#0f543e;font-weight:700}.bookmark-sidebar em{font-style:normal;font-size:11px}.bookmark-local-note{margin-top:30px;padding-top:20px;border-top:1px solid #d5dad5;display:grid;grid-template-columns:24px 1fr;gap:3px 8px}.bookmark-local-note i{grid-row:1/3;color:#287258}.bookmark-local-note strong{font-size:12px}.bookmark-local-note span{font-size:10px;color:#778079}.bookmark-list{padding:0 20px;overflow:hidden}.bookmark-list-head,.bookmark-row{display:grid;grid-template-columns:46px minmax(220px,1fr) minmax(150px,220px) 90px;align-items:center}.bookmark-list-head{height:52px;border-bottom:1px solid #d6dbd6;font:700 9px/1 monospace;color:#7a847e}.bookmark-list-head span:first-child{grid-column:1/3}.bookmark-row{width:100%;min-height:68px;border:0;border-bottom:1px solid #e0e3df;background:transparent;text-align:left;color:inherit}.bookmark-row:hover,.bookmark-row.active{background:#fff}.bookmark-favicon{width:30px;height:30px;background:#1d3028;color:#fff;display:grid;place-items:center;font:700 12px/1 monospace}.bookmark-main strong,.bookmark-main small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bookmark-main strong{font-size:13px}.bookmark-main small{font-size:10px;color:#879089;margin-top:5px}.bookmark-domain,.bookmark-row time{font-size:11px;color:#65716a;overflow:hidden;text-overflow:ellipsis}.bookmark-inspector label{display:block;font-size:10px;color:#68746c;margin:15px 0}.bookmark-inspector input{display:block;width:100%;height:38px;border:1px solid #cdd4cf;background:#fff;margin-top:7px;padding:0 10px;font-size:12px}.inspector-path{padding:14px 0;border-block:1px solid #d5dad6}.inspector-path span,.inspector-path strong{display:block}.inspector-path span{font-size:10px;color:#7b867f}.inspector-path strong{font-size:11px;margin-top:7px;line-height:1.5}.danger{margin-top:20px;border:1px solid #c6a29c;color:#8c2c20;background:transparent;height:38px;width:100%}.inspector-empty,.bookmark-empty{height:100%;display:grid;place-items:center;align-content:center;gap:9px;color:#89928c;text-align:center}.inspector-empty i,.bookmark-empty i{font-size:32px}.bookmark-empty{min-height:420px}.bookmark-empty strong{color:#536058}.bookmark-empty span{font-size:11px}.bookmark-status{display:flex;gap:28px;padding-top:13px;color:#6e7972;font-size:10px}.bookmark-status i{color:#27755a;margin-right:6px}.bookmark-actions button,.bookmark-find,.bookmark-favicon,.bookmark-notice,.bookmark-sidebar>button{border-radius:3px}@media(max-width:1050px){.bookmark-header{grid-template-columns:1fr}.bookmark-find{justify-self:stretch;max-width:none}.bookmark-actions{flex-wrap:wrap}.bookmark-workspace{grid-template-columns:180px 1fr}.bookmark-inspector{position:fixed;z-index:40;right:12px;bottom:12px;width:min(330px,calc(100vw - 24px));max-height:70vh;overflow:auto;border:1px solid #cbd2cd;box-shadow:0 16px 50px #10251a33}.bookmark-inspector:has(.inspector-empty){display:none}}@media(max-width:680px){.bookmark-desk{padding-inline:12px}.bookmark-workspace{grid-template-columns:1fr}.bookmark-sidebar{display:flex;overflow:auto;border-right:0;border-bottom:1px solid #d7dcd7;padding:12px 0}.bookmark-sidebar-title,.bookmark-local-note{display:none}.bookmark-sidebar>button{min-width:max-content;width:auto;padding:0 12px;display:flex;gap:8px}.bookmark-list{padding:0}.bookmark-list-head{display:none}.bookmark-row{grid-template-columns:42px 1fr}.bookmark-domain,.bookmark-row time{display:none}.bookmark-actions button span{display:none}}
</style>
