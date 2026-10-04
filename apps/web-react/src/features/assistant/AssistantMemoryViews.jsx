// 助手记忆：回复里的记忆改动卡片（可撤销），以及左侧“记忆”打开的管理面板。
// 面板沿用资产库抽屉的外框与原界面变量。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  createAssistantMemory,
  deleteAssistantMemory,
  getAssistantProactiveSettings,
  listAssistantMemories,
  setAssistantMemoryEnabled,
  undoAssistantMemoryChange,
  updateAssistantMemory,
  updateAssistantProactiveSettings,
} from './services/assistantApi.js'
import './assistant-commerce-set.css'
import './assistant-memory.css'

export const OPEN_MEMORY_EVENT = 'assistant:open-memory'

// tab is "memory" or "reminders".
export function openAssistantMemoryPanel(tab = 'memory') {
  window.dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { tab } }))
}

const KIND_LABELS = { brand: '品牌资料', product: '商品', style: '风格偏好', habit: '习惯', favorite: '满意方案' }
const KINDS = Object.keys(KIND_LABELS)
const MAX_TITLE = 60
const MAX_CONTENT = 1000

const CHANGE_TITLES = { created: '已记住', updated: '已更新记忆', deleted: '已忘掉' }

export function AssistantMemoryChangeView({ data }) {
  const [state, setState] = useState('done')
  const [error, setError] = useState('')
  const memory = data?.action === 'deleted' ? data?.previous : data?.memory
  if (!memory) return null
  const undo = async () => {
    setError('')
    setState('working')
    try {
      await undoAssistantMemoryChange(data)
      setState('undone')
    } catch (caught) {
      // Undoing a new memory that is already gone (deleted in the panel, or
      // undone before a reload) has nothing left to do.
      if (caught?.status === 404 && data.action === 'created') {
        setState('undone')
        return
      }
      setState('done')
      setError(caught?.message || '撤销失败，请重试')
    }
  }
  const before = data.action === 'updated' && data.previous?.content !== memory.content ? data.previous?.content : ''
  return (
    <section className="assistant-data assistant-memory-change" aria-label="记忆">
      <header className="assistant-data-head">
        <span><i className="bi bi-bookmark-heart" aria-hidden="true" /> {CHANGE_TITLES[data.action] || '记忆'} · {memory.kindLabel || KIND_LABELS[memory.kind]}</span>
      </header>
      <div className={`assistant-memory-change-body${data.action === 'deleted' ? ' is-deleted' : ''}`}>
        <strong>{memory.title}</strong>
        {memory.content && <p>{memory.content}</p>}
        {before && <p className="assistant-memory-before">原来：{before}</p>}
        <MemoryThumbs urls={memory.imageUrls} />
      </div>
      <div className="assistant-commerce-actions">
        {state === 'undone'
          ? <span className="assistant-data-note">已撤销。</span>
          : <button type="button" className="assistant-commerce-link" disabled={state === 'working'} onClick={() => void undo()}>{state === 'working' ? '撤销中…' : '撤销'}</button>}
        <button type="button" className="assistant-commerce-link" onClick={openAssistantMemoryPanel}>管理记忆</button>
      </div>
      {error && <p className="assistant-commerce-error" role="alert">{error}</p>}
    </section>
  )
}

// 记忆面板的线条图标：和图片编辑器、对话菜单同一套风格。
const MEMORY_ICONS = {
  brand: "M4.5 12.3V5.75A1.25 1.25 0 0 1 5.75 4.5h6.55l7.2 7.2a1.5 1.5 0 0 1 0 2.1l-5.7 5.7a1.5 1.5 0 0 1-2.1 0l-7.2-7.2ZM8.6 8.6h.01",
  product: "M12 3.75 19.5 8v8L12 20.25 4.5 16V8L12 3.75ZM4.5 8 12 12.25 19.5 8M12 12.25v8",
  style: "M12 4.5a7.5 7.5 0 0 0 0 15c1 0 1.5-.6 1.5-1.4 0-.5-.25-.85-.5-1.2-.3-.4-.5-.8-.5-1.3 0-.9.7-1.6 1.6-1.6h1.9a3.5 3.5 0 0 0 3.5-3.5C19.5 7.3 16.1 4.5 12 4.5ZM8.25 11.5h.01M10.5 8h.01M14.25 8h.01",
  habit: "M17 4.5 19.5 7 17 9.5M4.5 12v-2a3 3 0 0 1 3-3h12M7 19.5 4.5 17 7 14.5M19.5 12v2a3 3 0 0 1-3 3h-12",
  favorite: "M12 4.5l2.3 4.7 5.2.75-3.75 3.65.9 5.15L12 16.3l-4.65 2.45.9-5.15L4.5 9.95l5.2-.75L12 4.5Z",
  all: "M5 6.5h14M5 12h14M5 17.5h9",
  plus: "M12 5.5v13M5.5 12h13",
  search: "M10.75 17.5a6.75 6.75 0 1 0 0-13.5 6.75 6.75 0 0 0 0 13.5ZM19.5 19.5l-3.9-3.9",
  edit: "M4.5 19.5 5.6 15 15.7 4.9a2.1 2.1 0 0 1 3 3L8.6 18l-4.1 1.5ZM13.8 6.8l3 3",
  trash: "M4.75 7h14.5M9.5 7V5.75a1.25 1.25 0 0 1 1.25-1.25h2.5a1.25 1.25 0 0 1 1.25 1.25V7M6.75 7l.75 11.1a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4L17.25 7M10.25 10.75v5M13.75 10.75v5",
  lock: "M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5M6.5 10.5h11a1 1 0 0 1 1 1v7a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5v-7a1 1 0 0 1 1-1Z",
  memory: "M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v14l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
}

function MemoryIcon({ name, size = 16 }) {
  return (
    <svg className="memory-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={MEMORY_ICONS[name] || MEMORY_ICONS.memory} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// 今天 / 昨天 / 10月4日 / 2025年3月1日
function memoryDate(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const today = new Date()
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(date)) / 86400000)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function MemoryThumbs({ urls }) {
  const list = Array.isArray(urls) ? urls : []
  if (!list.length) return null
  return (
    <div className="assistant-memory-thumbs">
      {list.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" title="查看原图"><img src={url} alt="" loading="lazy" /></a>
      ))}
    </div>
  )
}

function MemoryForm({ initial, busy, onCancel, onSubmit }) {
  const [kind, setKind] = useState(initial?.kind || 'brand')
  const [title, setTitle] = useState(initial?.title || '')
  const [content, setContent] = useState(initial?.content || '')
  const valid = title.trim().length > 0
  return (
    <form className="assistant-memory-form" onSubmit={(event) => { event.preventDefault(); if (valid) onSubmit({ kind, title: title.trim(), content: content.trim() }) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}>
      <div className="assistant-memory-kinds" role="radiogroup" aria-label="记忆类型">
        {KINDS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={kind === id} data-kind={id}
            className={kind === id ? 'active' : ''} onClick={() => setKind(id)}>
            <MemoryIcon name={id} size={14} />{KIND_LABELS[id]}
          </button>
        ))}
      </div>
      <label className="assistant-memory-field">
        <input value={title} maxLength={MAX_TITLE} autoFocus placeholder="名称，如“品牌色”" aria-label="记忆名称" onChange={(event) => setTitle(event.target.value)} />
        <small>{title.length}/{MAX_TITLE}</small>
      </label>
      <label className="assistant-memory-field is-area">
        <textarea value={content} maxLength={MAX_CONTENT} rows={4} placeholder="内容，如“雾霾蓝 #8FA3B8，做图默认主色”" aria-label="记忆内容" onChange={(event) => setContent(event.target.value)} />
        <small>{content.length}/{MAX_CONTENT}</small>
      </label>
      <div className="assistant-memory-form-actions">
        <button type="button" className="assistant-memory-ghost" onClick={onCancel}>取消</button>
        <button type="submit" className="assistant-memory-primary" disabled={!valid || busy}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </form>
  )
}

const LONG_CONTENT = 110

function MemoryItem({ memory, busy, onSave, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const label = memory.kindLabel || KIND_LABELS[memory.kind]
  const long = (memory.content || '').length > LONG_CONTENT || (memory.content || '').split('\n').length > 3
  if (editing) {
    return (
      <li className="assistant-memory-item is-editing" data-kind={memory.kind}>
        <MemoryForm initial={memory} busy={busy} onCancel={() => setEditing(false)}
          onSubmit={async (patch) => { if (await onSave(memory, patch)) setEditing(false) }} />
      </li>
    )
  }
  const date = memoryDate(memory.updatedAt || memory.createdAt)
  return (
    <li className="assistant-memory-item" data-kind={memory.kind}>
      <div className="assistant-memory-item-head">
        <span className="assistant-memory-badge" aria-hidden="true"><MemoryIcon name={memory.kind} size={15} /></span>
        <strong title={memory.title}>{memory.title}</strong>
        <span className="assistant-memory-kind">{label}</span>
      </div>
      {memory.content && (
        <div className="assistant-memory-text">
          <p className={`assistant-memory-content${long && !expanded ? ' is-clamped' : ''}`}>{memory.content}</p>
          {long && <button type="button" className="assistant-memory-more" onClick={() => setExpanded((value) => !value)}>{expanded ? '收起' : '展开'}</button>}
        </div>
      )}
      <MemoryThumbs urls={memory.imageUrls} />
      <div className="assistant-memory-item-foot">
        <span>{memory.source === 'assistant' ? '对话中记下' : '我添加的'}{date ? ` · ${date}` : ''}</span>
        <span className="assistant-memory-item-actions">
          <button type="button" aria-label="编辑" title="编辑" onClick={() => setEditing(true)}><MemoryIcon name="edit" size={15} /></button>
          <button type="button" aria-label="删除" title="删除" className="is-danger" disabled={busy} onClick={() => onDelete(memory)}><MemoryIcon name="trash" size={15} /></button>
        </span>
      </div>
    </li>
  )
}

const REPORT_OPTIONS = [
  { id: '', label: '关闭' },
  { id: 'daily', label: '每天' },
  { id: 'weekly', label: '每周一' },
]

// The 提醒 tab: what the assistant may tell the user without being asked.
function ReminderSettings() {
  const [settings, setSettings] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    getAssistantProactiveSettings({ signal: controller.signal })
      .then(setSettings)
      .catch((caught) => { if (caught?.name !== 'AbortError') setError(caught?.message || '提醒设置读取失败') })
    return () => controller.abort()
  }, [])
  const change = async (patch) => {
    setBusy(true)
    setError('')
    try {
      setSettings(await updateAssistantProactiveSettings(patch))
    } catch (caught) {
      setError(caught?.message || '保存失败，请重试')
    } finally {
      setBusy(false)
    }
  }
  if (!settings) return <div className="assistant-memory-body">{error ? <p className="assistant-commerce-error" role="alert">{error}</p> : <p className="assistant-data-note">正在读取提醒设置…</p>}</div>
  const limits = settings.thresholds || {}
  return (
    <div className="assistant-memory-body">
      <p className="assistant-memory-lead">提醒会发到对应的对话（异常提醒和报告发到“助手提醒”对话），同时出现在右上角的通知里。</p>
      <label className="assistant-memory-switch">
        <span>
          <strong>长任务完成通知</strong>
          <small>电商套图等出图任务结束时告诉你结果，有失败会说明</small>
        </span>
        <input type="checkbox" role="switch" aria-label="长任务完成通知" checked={settings.taskNotices} disabled={busy} onChange={() => void change({ taskNotices: !settings.taskNotices })} />
      </label>
      <label className="assistant-memory-switch">
        <span>
          <strong>异常提醒</strong>
          <small>{`积分低于 ${limits.lowBalancePoints ?? 50}；当天消耗超过近 7 天日均的 ${limits.spikeFactor ?? 3} 倍（至少 ${limits.spikeMinPoints ?? 100} 积分）；当天失败率超过 ${Math.round((limits.failureRate ?? 0.3) * 100)}%（至少 ${limits.failureMinTasks ?? 5} 次）。每类每天最多一次。`}</small>
        </span>
        <input type="checkbox" role="switch" aria-label="异常提醒" checked={settings.alerts} disabled={busy} onChange={() => void change({ alerts: !settings.alerts })} />
      </label>
      <label className="assistant-memory-switch">
        <span>
          <strong>主动建议</strong>
          <small>新对话里按你的记忆和最近做的套图给出“接着做”的建议，例如按上次满意的方案再做一套；对话里没说平台或风格时，会按你的习惯来并说明</small>
        </span>
        <input type="checkbox" role="switch" aria-label="主动建议" checked={settings.suggestions !== false} disabled={busy} onChange={() => void change({ suggestions: settings.suggestions === false })} />
      </label>
      <div className="assistant-memory-switch is-static">
        <span>
          <strong>定时用量报告</strong>
          <small>{`每天或每周一 ${limits.reportHour ?? 9}:00 后，把上一天或上一周的消耗、出图和成功率发给你`}</small>
        </span>
        <select aria-label="定时用量报告" value={settings.reportSchedule || ''} disabled={busy} onChange={(event) => void change({ reportSchedule: event.target.value })}>
          {REPORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
      {error && <p className="assistant-commerce-error" role="alert">{error}</p>}
    </div>
  )
}

export function AssistantMemoryPanel({ open, dark, initialTab = 'memory', onClose }) {
  const [tab, setTab] = useState(initialTab)
  useEffect(() => { if (open) setTab(initialTab) }, [open, initialTab])
  const [mounted, setMounted] = useState(open)
  const [entered, setEntered] = useState(false)
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 刚删除的那条：几秒内可以撤销。
  const [deleted, setDeleted] = useState(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => setEntered(true)))
      return () => window.cancelAnimationFrame(frame)
    }
    setEntered(false)
    setAdding(false)
    setQuery('')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setMounted(false), reduced ? 0 : 320)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setError('')
    listAssistantMemories({ signal: controller.signal })
      .then((result) => setData(result))
      .catch((caught) => { if (caught?.name !== 'AbortError') setError(caught?.message || '记忆读取失败') })
    return () => controller.abort()
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!deleted) return undefined
    const timer = window.setTimeout(() => setDeleted(null), 6000)
    return () => window.clearTimeout(timer)
  }, [deleted])

  if (!mounted) return null
  const items = Array.isArray(data?.items) ? data.items : []
  const limit = data?.limit || 200
  const needle = query.trim().toLowerCase()
  const visible = items
    .filter((item) => filter === 'all' || item.kind === filter)
    .filter((item) => !needle || `${item.title}\n${item.content}`.toLowerCase().includes(needle))
  const enabled = data?.enabled !== false

  const act = async (action) => {
    setError('')
    setBusy(true)
    try {
      await action()
      return true
    } catch (caught) {
      setError(caught?.message || '操作失败，请重试')
      return false
    } finally {
      setBusy(false)
    }
  }
  const replace = (memory) => setData((current) => ({ ...current, items: (current?.items || []).map((item) => item.id === memory.id ? memory : item) }))
  const prepend = (memory) => setData((current) => ({ ...current, items: [memory, ...(current?.items || []).filter((item) => item.id !== memory.id)] }))
  const add = (patch) => act(async () => {
    const change = await createAssistantMemory(patch)
    if (change?.memory) prepend(change.memory)
    setAdding(false)
  })
  const save = (memory, patch) => act(async () => {
    const change = await updateAssistantMemory(memory.id, patch)
    if (change?.memory) replace(change.memory)
  })
  const remove = (memory) => act(async () => {
    await deleteAssistantMemory(memory.id)
    setData((current) => ({ ...current, items: (current?.items || []).filter((item) => item.id !== memory.id) }))
    setDeleted(memory)
  })
  const undoDelete = () => act(async () => {
    const memory = deleted
    setDeleted(null)
    const change = await createAssistantMemory({ kind: memory.kind, title: memory.title, content: memory.content, imageKeys: memory.imageKeys || [] })
    if (change?.memory) prepend(change.memory)
  })
  const toggle = () => act(async () => {
    const result = await setAssistantMemoryEnabled(!enabled)
    setData((current) => ({ ...current, enabled: result?.enabled ?? !enabled }))
  })
  const full = items.length >= limit

  return createPortal(
    <div className={`asset-library-layer${dark ? ' is-dark' : ''}${entered ? ' is-open' : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className={`assistant-workspace${dark ? ' is-dark' : ''}`}>
        <aside className="asset-library-panel assistant-memory-panel" role="dialog" aria-modal="true" aria-label="记忆与提醒" onMouseDown={(event) => event.stopPropagation()}>
          <header className="assistant-memory-header">
            <div className="assistant-memory-title">
              <span className="assistant-memory-title-icon" aria-hidden="true"><MemoryIcon name="memory" size={18} /></span>
              <h2>记忆与提醒</h2>
              <button className="assistant-memory-close" type="button" title="关闭" aria-label="关闭记忆与提醒" onClick={onClose}><MemoryIcon name="close" size={18} /></button>
            </div>
            <div className="assistant-memory-tabs" role="tablist" aria-label="记忆与提醒">
              <button type="button" role="tab" aria-selected={tab === 'memory'} className={tab === 'memory' ? 'active' : ''} onClick={() => setTab('memory')}>记忆{items.length ? <span>{items.length}</span> : null}</button>
              <button type="button" role="tab" aria-selected={tab === 'reminders'} className={tab === 'reminders' ? 'active' : ''} onClick={() => setTab('reminders')}>提醒</button>
            </div>
          </header>
          {tab === 'reminders' ? <ReminderSettings /> : <>
          <label className={`assistant-memory-switch is-hero${enabled ? ' is-on' : ''}`}>
            <span>
              <strong>使用记忆</strong>
              <small>{enabled ? '助手会记住你的品牌、商品、偏好和满意的方案，出图和回答时自动用上' : '已关闭：助手不会读取或新增记忆，已有记忆保留'}</small>
            </span>
            <input type="checkbox" role="switch" aria-label="使用记忆" checked={enabled} disabled={!data || busy} onChange={() => void toggle()} />
          </label>
          <div className="assistant-memory-toolbar">
            <label className="assistant-memory-search">
              <MemoryIcon name="search" size={16} />
              <input type="search" value={query} placeholder="搜索记忆" aria-label="搜索记忆" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <button type="button" className="assistant-memory-primary" aria-label="添加记忆" disabled={full || adding}
              title={full ? `最多 ${limit} 条，先删掉一些再添加` : '添加记忆'} onClick={() => setAdding(true)}>
              <MemoryIcon name="plus" size={16} />添加
            </button>
          </div>
          <nav className="assistant-memory-filters" aria-label="按类型筛选">
            {['all', ...KINDS].map((id) => {
              const count = id === 'all' ? items.length : items.filter((item) => item.kind === id).length
              return (
                <button key={id} type="button" data-kind={id} className={`${filter === id ? 'active' : ''}${count ? '' : ' is-empty'}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  <MemoryIcon name={id} size={14} />
                  {id === 'all' ? '全部' : KIND_LABELS[id]}
                  {count ? <span>{count}</span> : null}
                </button>
              )
            })}
          </nav>
          <div className={`assistant-memory-body${enabled ? '' : ' is-disabled'}`}>
            {adding && (
              <div className="assistant-memory-item is-editing is-new">
                <MemoryForm initial={{ kind: filter === 'all' ? 'brand' : filter }} busy={busy} onCancel={() => setAdding(false)} onSubmit={(patch) => void add(patch)} />
              </div>
            )}
            {error && <p className="assistant-commerce-error" role="alert">{error}</p>}
            {!data && !error && (
              <ul className="assistant-memory-list" aria-label="正在读取记忆">
                {[0, 1, 2].map((index) => <li key={index} className="assistant-memory-item is-skeleton" aria-hidden="true"><b /><b /><b /></li>)}
              </ul>
            )}
            {data && !visible.length && !adding && (
              <div className="assistant-memory-empty">
                <span aria-hidden="true"><MemoryIcon name={needle ? 'search' : filter === 'all' ? 'memory' : filter} size={24} /></span>
                <strong>{needle ? '没有找到相关的记忆' : items.length ? `还没有「${KIND_LABELS[filter]}」类的记忆` : '还没有记忆'}</strong>
                <p>{needle ? '换个关键词试试' : '在对话里说“记住……”，或者手动添加一条'}</p>
                {!needle && <button type="button" className="assistant-memory-ghost" onClick={() => setAdding(true)}><MemoryIcon name="plus" size={14} />添加记忆</button>}
              </div>
            )}
            <ul className="assistant-memory-list">
              {visible.map((memory) => <MemoryItem key={memory.id} memory={memory} busy={busy} onSave={save} onDelete={(item) => void remove(item)} />)}
            </ul>
          </div>
          {deleted && (
            <div className="assistant-memory-undo" role="status">
              <span>已删除「{deleted.title}」</span>
              <button type="button" disabled={busy} onClick={() => void undoDelete()}>撤销</button>
            </div>
          )}
          <footer className="assistant-memory-footer">
            <div className="assistant-memory-usage">
              <span>{items.length} / {limit} 条记忆</span>
              <span className="assistant-memory-usage-bar" aria-hidden="true"><i className={full ? 'is-full' : ''} style={{ width: `${Math.min(100, (items.length / limit) * 100)}%` }} /></span>
            </div>
            <small><MemoryIcon name="lock" size={13} />只有你自己能看到</small>
          </footer>
          </>}
        </aside>
      </div>
    </div>,
    document.body,
  )
}

// Footer on messages the assistant sent by itself, with the way to turn them off.
export function AssistantProactiveNote({ kind }) {
  const label = { task_done: '任务完成通知', alert: '异常提醒', report: '定时报告' }[kind] || '主动提醒'
  return (
    <p className="assistant-proactive-note">
      <i className="bi bi-bell" aria-hidden="true" /> 助手主动发送 · {label}
      <button type="button" onClick={() => openAssistantMemoryPanel('reminders')}>提醒设置</button>
    </p>
  )
}
