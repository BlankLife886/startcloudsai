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

function MemoryThumbs({ urls }) {
  const list = Array.isArray(urls) ? urls : []
  if (!list.length) return null
  return (
    <div className="assistant-memory-thumbs">
      {list.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="" loading="lazy" /></a>
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
    <form className="assistant-memory-form" onSubmit={(event) => { event.preventDefault(); if (valid) onSubmit({ kind, title: title.trim(), content: content.trim() }) }}>
      <div className="assistant-memory-form-row">
        <select value={kind} aria-label="记忆类型" onChange={(event) => setKind(event.target.value)}>
          {KINDS.map((id) => <option key={id} value={id}>{KIND_LABELS[id]}</option>)}
        </select>
        <input value={title} maxLength={MAX_TITLE} placeholder="名称，如“品牌色”" aria-label="记忆名称" onChange={(event) => setTitle(event.target.value)} />
      </div>
      <textarea value={content} maxLength={MAX_CONTENT} rows={3} placeholder="内容，如“雾霾蓝 #8FA3B8，做图默认主色”" aria-label="记忆内容" onChange={(event) => setContent(event.target.value)} />
      <div className="assistant-memory-form-actions">
        <button type="button" className="assistant-memory-ghost" onClick={onCancel}>取消</button>
        <button type="submit" className="assistant-commerce-primary" disabled={!valid || busy}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </form>
  )
}

function MemoryItem({ memory, busy, onSave, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  if (editing) {
    return (
      <li className="assistant-memory-item">
        <MemoryForm initial={memory} busy={busy} onCancel={() => setEditing(false)}
          onSubmit={async (patch) => { if (await onSave(memory, patch)) setEditing(false) }} />
      </li>
    )
  }
  return (
    <li className="assistant-memory-item">
      <div className="assistant-memory-item-head">
        <strong title={memory.title}>{memory.title}</strong>
        <span className="assistant-memory-kind">{memory.kindLabel || KIND_LABELS[memory.kind]}</span>
      </div>
      {memory.content && <p className="assistant-memory-content">{memory.content}</p>}
      <MemoryThumbs urls={memory.imageUrls} />
      <div className="assistant-memory-item-foot">
        <span>{memory.source === 'assistant' ? '对话中记下' : '我添加的'}</span>
        {confirming ? (
          <span className="assistant-memory-item-actions">
            <button type="button" className="is-danger" disabled={busy} onClick={() => onDelete(memory)}>确认删除</button>
            <button type="button" onClick={() => setConfirming(false)}>取消</button>
          </span>
        ) : (
          <span className="assistant-memory-item-actions">
            <button type="button" onClick={() => setEditing(true)}>编辑</button>
            <button type="button" onClick={() => setConfirming(true)}>删除</button>
          </span>
        )}
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
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setMounted(true)
      const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => setEntered(true)))
      return () => window.cancelAnimationFrame(frame)
    }
    setEntered(false)
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

  if (!mounted) return null
  const items = Array.isArray(data?.items) ? data.items : []
  const visible = filter === 'all' ? items : items.filter((item) => item.kind === filter)
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
  const add = (patch) => act(async () => {
    const change = await createAssistantMemory(patch)
    const memory = change?.memory
    if (memory) setData((current) => ({ ...current, items: [memory, ...(current?.items || []).filter((item) => item.id !== memory.id)] }))
    setAdding(false)
  })
  const save = (memory, patch) => act(async () => {
    const change = await updateAssistantMemory(memory.id, patch)
    if (change?.memory) replace(change.memory)
  })
  const remove = (memory) => act(async () => {
    await deleteAssistantMemory(memory.id)
    setData((current) => ({ ...current, items: (current?.items || []).filter((item) => item.id !== memory.id) }))
  })
  const toggle = () => act(async () => {
    const result = await setAssistantMemoryEnabled(!enabled)
    setData((current) => ({ ...current, enabled: result?.enabled ?? !enabled }))
  })

  return createPortal(
    <div className={`asset-library-layer${dark ? ' is-dark' : ''}${entered ? ' is-open' : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className={`assistant-workspace${dark ? ' is-dark' : ''}`}>
        <aside className="asset-library-panel assistant-memory-panel" role="dialog" aria-modal="true" aria-label="记忆与提醒" onMouseDown={(event) => event.stopPropagation()}>
          <header className="asset-library-header">
            <div className="asset-library-heading">
              <p className="asset-library-kicker">记忆与提醒</p>
              <div className="asset-library-tabs" role="tablist" aria-label="记忆与提醒">
                <button type="button" role="tab" aria-selected={tab === 'memory'} className={tab === 'memory' ? 'active' : ''} onClick={() => setTab('memory')}>记忆</button>
                <button type="button" role="tab" aria-selected={tab === 'reminders'} className={tab === 'reminders' ? 'active' : ''} onClick={() => setTab('reminders')}>提醒</button>
              </div>
            </div>
            <button className="asset-close" type="button" title="关闭" aria-label="关闭记忆与提醒" onClick={onClose}><i className="bi bi-x-lg" /></button>
          </header>
          {tab === 'reminders' ? <ReminderSettings /> : <>
          <p className="assistant-memory-lead">助手会记住你的品牌、商品、偏好和满意的方案，出图和回答时自动用上。</p>
          <label className="assistant-memory-switch">
            <span>
              <strong>使用记忆</strong>
              <small>{enabled ? '对话时会参考并更新这些记忆' : '已关闭：助手不会读取或新增记忆，已有记忆保留'}</small>
            </span>
            <input type="checkbox" role="switch" aria-label="使用记忆" checked={enabled} disabled={!data || busy} onChange={() => void toggle()} />
          </label>
          <nav className="assistant-memory-filters" aria-label="按类型筛选">
            {['all', ...KINDS].map((id) => {
              const count = id === 'all' ? items.length : items.filter((item) => item.kind === id).length
              return (
                <button key={id} type="button" className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {id === 'all' ? '全部' : KIND_LABELS[id]}{count ? ` ${count}` : ''}
                </button>
              )
            })}
          </nav>
          <div className="assistant-memory-body">
            {adding
              ? <MemoryForm initial={{ kind: filter === 'all' ? 'brand' : filter }} busy={busy} onCancel={() => setAdding(false)} onSubmit={(patch) => void add(patch)} />
              : <button type="button" className="assistant-memory-add" onClick={() => setAdding(true)}><i className="bi bi-plus-lg" aria-hidden="true" /> 添加记忆</button>}
            {error && <p className="assistant-commerce-error" role="alert">{error}</p>}
            {!data && !error && <p className="assistant-data-note">正在读取记忆…</p>}
            {data && !visible.length && !adding && (
              <div className="asset-empty"><i className="bi bi-bookmark-heart" /><p>{items.length ? '这一类还没有记忆' : '还没有记忆。在对话里说“记住……”，或在这里添加。'}</p></div>
            )}
            <ul className="assistant-memory-list">
              {visible.map((memory) => <MemoryItem key={memory.id} memory={memory} busy={busy} onSave={save} onDelete={(item) => void remove(item)} />)}
            </ul>
          </div>
          <footer className="asset-library-footer">
            <span>{items.length} 条记忆</span>
            <small>最多 {data?.limit || 200} 条，只有你自己能看到</small>
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
