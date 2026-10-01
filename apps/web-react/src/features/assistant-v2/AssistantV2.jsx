import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx'
import { useAssistantV2 } from './useAssistantV2.js'
import { V2Composer, V2Thread } from './components/V2Thread.jsx'
import './assistant-v2.css'

const SUGGESTIONS = [
  { icon: 'bi-pie-chart', text: '这个月积分都花在哪了？' },
  { icon: 'bi-graph-up', text: '最近 30 天我每天创作了多少张图？' },
  { icon: 'bi-list-ol', text: '最贵的 10 次生成是哪些？' },
  { icon: 'bi-clipboard-check', text: '我的生成成功率怎么样，失败多吗？' },
]

function formatUpdated(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, runsByConversation }) {
  return (
    <aside className="av2-sidebar" aria-label="对话列表">
      <button type="button" className="av2-new" onClick={onNew}>
        <i className="bi bi-plus-lg" aria-hidden="true" /> 新对话
      </button>
      <nav className="av2-conversations">
        {conversations.length === 0 && <p className="av2-sidebar-empty">还没有对话</p>}
        {conversations.map((conversation) => (
          <div key={conversation.id} className={`av2-conversation${conversation.id === activeId ? ' is-active' : ''}`}>
            <button type="button" className="av2-conversation-main" onClick={() => onSelect(conversation.id)}
              aria-current={conversation.id === activeId ? 'page' : undefined}>
              <span className="av2-conversation-title">
                {runsByConversation.has(conversation.id) && <span className="av2-live" aria-label="进行中" />}
                {conversation.title}
              </span>
              <span className="av2-conversation-time">{formatUpdated(conversation.updatedAt)}</span>
            </button>
            <button type="button" className="av2-conversation-delete" aria-label={`删除对话：${conversation.title}`}
              onClick={() => onDelete(conversation)}>
              <i className="bi bi-trash3" aria-hidden="true" />
            </button>
          </div>
        ))}
      </nav>
    </aside>
  )
}

function EmptyState({ onPick, signedIn }) {
  return (
    <div className="av2-empty">
      <h1>今天想把什么事办成？</h1>
      <p>直接说目标就行。我可以查你的用量和消费、解释扣费、给出创作建议。</p>
      <div className="av2-suggestions">
        {SUGGESTIONS.map((item) => (
          <button key={item.text} type="button" onClick={() => onPick(item.text)}>
            <i className={`bi ${item.icon}`} aria-hidden="true" />
            <span>{item.text}</span>
          </button>
        ))}
      </div>
      {!signedIn && <p className="av2-empty-note">登录后才能查询你自己的数据。</p>}
    </div>
  )
}

function CostDialog({ prompt, remember, setRemember, onAnswer }) {
  const confirmRef = useRef(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape') onAnswer(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAnswer])
  return (
    <div className="av2-dialog-layer" onClick={(event) => { if (event.target === event.currentTarget) onAnswer(false) }}>
      <div className="av2-dialog" role="dialog" aria-modal="true" aria-labelledby="av2-cost-title">
        <h2 id="av2-cost-title">确认本轮费用</h2>
        <p>
          本轮使用 {prompt.model || '默认模型'}，按 <strong>{prompt.price} 积分/轮</strong> 计费。
          成功后结算，失败自动退回；主动停止不退还本轮积分。
        </p>
        <label className="av2-dialog-check">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          以后不再确认每轮费用
        </label>
        <footer>
          <button type="button" className="av2-button" onClick={() => onAnswer(false)}>取消</button>
          <button type="button" className="av2-button is-primary" ref={confirmRef} onClick={() => onAnswer(true)}>发送</button>
        </footer>
      </div>
    </div>
  )
}

export function AssistantV2() {
  const workspace = useAssistantV2()
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [rememberCost, setRememberCost] = useState(false)
  const runsByConversation = new Set([
    ...(workspace.running ? [workspace.running.conversationId] : []),
    ...workspace.queued.map((run) => run.conversationId),
  ])
  const messages = workspace.thread.messages || []

  return (
    <div className="av2" data-testid="assistant-v2">
      <Sidebar
        conversations={workspace.conversations}
        activeId={workspace.activeId}
        onSelect={workspace.selectConversation}
        onNew={() => workspace.selectConversation('')}
        onDelete={setDeleteTarget}
        runsByConversation={runsByConversation}
      />
      <main className="av2-main">
        <div className="av2-gray-banner" role="note">
          <span>新版 AI 助手（测试中）· <a href="/assistant">返回旧版</a></span>
          <label className="av2-mobile-picker">
            <span className="av2-visually-hidden">切换对话</span>
            <select value={workspace.activeId} onChange={(event) => workspace.selectConversation(event.target.value)}>
              <option value="">＋ 新对话</option>
              {workspace.conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
              ))}
            </select>
          </label>
        </div>
        {workspace.serviceError ? (
          <div className="av2-empty"><p className="av2-error" role="alert">{workspace.serviceError}</p></div>
        ) : messages.length || workspace.activeId ? (
          <V2Thread thread={workspace.thread} onLoadEarlier={workspace.loadEarlier} onRetry={(text) => workspace.send(text)} />
        ) : (
          <EmptyState signedIn={Boolean(workspace.auth.user?.id)} onPick={(text) => workspace.send(text)} />
        )}
        {workspace.queued.length > 0 && (
          <p className="av2-queue" role="status">还有 {workspace.queued.length} 条消息在排队，会依次处理。</p>
        )}
        <V2Composer
          draft={workspace.draft}
          setDraft={workspace.setDraft}
          onSend={() => workspace.send()}
          onStop={workspace.stop}
          busy={workspace.busy}
          sending={workspace.sending}
          stopping={workspace.stopping}
          maxCharacters={workspace.maxCharacters}
          turnPrice={workspace.turnPrice}
        />
      </main>
      {workspace.costPrompt && (
        <CostDialog
          prompt={workspace.costPrompt}
          remember={rememberCost}
          setRemember={setRememberCost}
          onAnswer={(accepted) => workspace.answerCost(accepted, { remember: accepted && rememberCost })}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        heading="删除这个对话？"
        description={`“${deleteTarget?.title || ''}”及其中的内容会被删除，无法恢复。`}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) void workspace.deleteConversation(target.id)
        }}
      />
    </div>
  )
}
