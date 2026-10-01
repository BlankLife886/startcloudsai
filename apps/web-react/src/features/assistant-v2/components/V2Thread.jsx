import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { V2Markdown } from './V2Markdown.jsx'
import { V2DataView } from './V2DataView.jsx'

const STAGE_LABELS = {
  sending: '正在发送',
  queued: '排队中',
  'waiting-capacity': '等待空闲额度',
  'preparing-context': '整理上下文',
  'compacting-context': '压缩较早的对话',
  thinking: '思考中',
  routing: '判断需要做什么',
  tool: '正在查询',
  answering: '正在回答',
}

function stageLabel(message) {
  return STAGE_LABELS[message.stage] || (message.pending ? '处理中' : '')
}

function ToolTimeline({ steps }) {
  const [open, setOpen] = useState(false)
  if (!steps?.length) return null
  const running = steps.some((step) => step.status === 'running')
  const failed = steps.filter((step) => step.status === 'failed').length
  const summary = running
    ? `正在${steps[steps.length - 1].label}`
    : `用了 ${steps.length} 个工具${failed ? `，${failed} 个失败` : ''}`
  return (
    <div className="av2-tools">
      <button type="button" className="av2-tools-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <i className={`bi ${running ? 'bi-arrow-repeat av2-spin' : 'bi-check2-circle'}`} aria-hidden="true" />
        <span>{summary}</span>
        <i className={`bi ${open ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true" />
      </button>
      {open && (
        <ol className="av2-tools-list">
          {steps.map((step) => (
            <li key={step.key} className={`is-${step.status}`}>
              <i className={`bi ${step.icon}`} aria-hidden="true" />
              <span className="av2-tool-name">{step.label}</span>
              {step.summary && <span className="av2-tool-summary">{step.summary}</span>}
              <span className="av2-tool-status">
                {step.status === 'running' ? '进行中' : step.status === 'failed' ? '失败' : step.durationMs ? `${step.durationMs} ms` : '完成'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function AssistantMessage({ message, onRetry }) {
  const label = message.pending ? stageLabel(message) : ''
  return (
    <article className={`av2-message is-assistant${message.pending ? ' is-pending' : ''}`} data-message-id={message.id}>
      <ToolTimeline steps={message.toolSteps} />
      {message.dataViews.map((view, index) => <V2DataView key={`${view.tool}-${index}`} view={view} />)}
      {message.content
        ? <V2Markdown content={message.content} />
        : message.pending && (
          <p className="av2-status" role="status">
            <span className="av2-dots" aria-hidden="true"><i /><i /><i /></span>
            {label}
          </p>
        )}
      {message.pending && message.content && label && <p className="av2-status is-inline" role="status">{label}</p>}
      {!message.pending && message.stage === 'stopped' && <p className="av2-note">已停止</p>}
      {message.error && !message.pending && (
        <div className="av2-error" role="alert">
          <i className="bi bi-exclamation-circle" aria-hidden="true" />
          <span>{message.error}</span>
          {onRetry && <button type="button" onClick={onRetry}>重试</button>}
        </div>
      )}
    </article>
  )
}

function UserMessage({ message }) {
  return (
    <article className="av2-message is-user" data-message-id={message.id}>
      <div className="av2-bubble">{message.content}</div>
    </article>
  )
}

export function V2Thread({ thread, onLoadEarlier, onRetry }) {
  const scrollerRef = useRef(null)
  const stickRef = useRef(true)
  const messages = thread.messages || []
  const lastContent = messages.length ? `${messages[messages.length - 1].id}:${messages[messages.length - 1].content.length}:${messages[messages.length - 1].toolSteps.length}:${messages[messages.length - 1].dataViews.length}` : ''

  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (node && stickRef.current) node.scrollTop = node.scrollHeight
  }, [lastContent, messages.length])

  useEffect(() => {
    stickRef.current = true
  }, [thread])

  const onScroll = () => {
    const node = scrollerRef.current
    if (!node) return
    stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
  }

  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  return (
    <div className="av2-thread" ref={scrollerRef} onScroll={onScroll}>
      <div className="av2-thread-inner">
        {thread.hasMore && (
          <button type="button" className="av2-link-button av2-earlier" onClick={onLoadEarlier}>加载更早的对话</button>
        )}
        {messages.map((message, index) => {
          if (message.role === 'user') return <UserMessage key={message.id} message={message} />
          if (message.role !== 'assistant') return null
          const isLast = index === messages.length - 1
          return (
            <AssistantMessage
              key={message.id}
              message={message}
              onRetry={isLast && message.error && lastUser ? () => onRetry(lastUser.content) : null}
            />
          )
        })}
      </div>
    </div>
  )
}

export function V2Composer({ draft, setDraft, onSend, onStop, busy, sending, stopping, maxCharacters, turnPrice }) {
  const textareaRef = useRef(null)
  useLayoutEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(200, node.scrollHeight)}px`
  }, [draft])
  const length = [...draft].length
  const tooLong = length > maxCharacters
  const canSend = draft.trim() && !tooLong && !sending
  return (
    <form
      className="av2-composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSend) onSend()
      }}
    >
      <label className="av2-visually-hidden" htmlFor="av2-input">给 AI 助手发消息</label>
      <textarea
        id="av2-input"
        ref={textareaRef}
        rows={1}
        value={draft}
        placeholder="说说你想做什么，比如“这个月积分都花哪了”"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (canSend) onSend()
          }
        }}
      />
      <div className="av2-composer-bar">
        <span className={`av2-composer-hint${tooLong ? ' is-error' : ''}`}>
          {tooLong
            ? `超出 ${(length - maxCharacters).toLocaleString('zh-CN')} 个字符`
            : turnPrice ? `每轮 ${turnPrice} 积分 · Enter 发送，Shift+Enter 换行` : 'Enter 发送，Shift+Enter 换行'}
        </span>
        {busy && (
          <button type="button" className="av2-stop" onClick={onStop} disabled={stopping} aria-label="停止当前任务">
            <i className="bi bi-stop-fill" aria-hidden="true" />
            {stopping ? '停止中' : '停止'}
          </button>
        )}
        <button type="submit" className="av2-send" disabled={!canSend} aria-label={busy ? '加入队列' : '发送'}>
          <i className={`bi ${sending ? 'bi-arrow-repeat av2-spin' : 'bi-arrow-up'}`} aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
