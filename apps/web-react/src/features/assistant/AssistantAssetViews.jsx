// 资产卡片：按描述找到的图（资产库 + 生成记录），以及存入资产库 / 整理资产库的方案（确认后执行，可撤销）。
import { useState } from 'react'
import { Link } from 'react-router'
import { executeAssistantAssetAction, undoAssistantAssetAction } from './services/assistantApi.js'
import './assistant-commerce-set.css'

export function AssistantAssetsView({ data }) {
  const [copied, setCopied] = useState('')
  const items = Array.isArray(data?.items) ? data.items : []
  if (!items.length) {
    return <section className="assistant-data"><p className="assistant-data-note">没有找到相关的图片。</p></section>
  }
  const copyPrompt = async (item) => {
    try {
      await navigator.clipboard.writeText(item.prompt)
      setCopied(item.id)
    } catch {
      setCopied('')
    }
  }
  return (
    <section className="assistant-data" aria-label="找到的图片">
      <header className="assistant-data-head">
        <span>{data?.query ? `“${data.query}”` : '最近的图片'} · {items.length} 张</span>
      </header>
      <ul className="assistant-commerce-grid">
        {items.map((item) => (
          <li className="assistant-commerce-shot" key={item.id}>
            <div className="assistant-commerce-shot-frame" style={{ aspectRatio: '1 / 1' }}>
              <a href={item.originalUrl || item.imageUrl} target="_blank" rel="noreferrer">
                <img src={item.imageUrl} alt={item.title} loading="lazy" />
              </a>
            </div>
            <div className="assistant-commerce-shot-meta">
              <strong title={item.title}>{item.title}</strong>
              <span className="assistant-commerce-status">{item.kind === 'asset' ? (item.group || '资产库') : (item.workspace || '生成')}</span>
            </div>
            {item.kind === 'generated' && item.prompt ? (
              <button type="button" className="assistant-commerce-link" onClick={() => copyPrompt(item)}>
                {copied === item.id ? '已复制提示词' : '复制提示词'}
              </button>
            ) : (
              <Link className="assistant-commerce-link" to={item.link}>在资产库查看</Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function AssistantAssetActionView({ data }) {
  const [state, setState] = useState('proposed')
  const [undo, setUndo] = useState(null)
  const [error, setError] = useState('')
  if (!data?.action) return null
  const titles = Array.isArray(data.titles) ? data.titles : []
  const saving = data.action === 'save'
  const images = saving && Array.isArray(data.images) ? data.images : []
  const saved = undo?.items?.length || 0
  const run = async (action) => {
    setError('')
    try {
      await action()
    } catch (caught) {
      setError(caught?.message || '操作失败，请重试')
    }
  }
  return (
    <section className="assistant-data assistant-commerce" aria-label="资产整理">
      <header className="assistant-data-head"><span>{saving ? '存入资产库' : '资产整理'}</span></header>
      <p className="assistant-commerce-summary">{data.summary}</p>
      {images.length > 0 && (
        <ul className="assistant-commerce-grid">
          {images.slice(0, 12).map((image) => (
            <li className="assistant-commerce-shot" key={image.key}>
              <div className="assistant-commerce-shot-frame" style={{ aspectRatio: '1 / 1' }}>
                <img src={image.thumbUrl} alt={image.title} loading="lazy" />
              </div>
              <div className="assistant-commerce-shot-meta"><strong title={image.title}>{image.title}</strong></div>
            </li>
          ))}
        </ul>
      )}
      {!saving && titles.length > 0 && (
        <p className="assistant-data-note">{titles.slice(0, 8).join('、')}{titles.length > 8 ? ` 等 ${titles.length} 个` : ''}</p>
      )}
      <div className="assistant-commerce-actions">
        {state === 'proposed' && (
          <button type="button" className="assistant-commerce-primary"
            onClick={() => run(async () => {
              setState('working')
              try {
                const result = await executeAssistantAssetAction(data)
                setUndo(result?.undo || null)
                setState('done')
              } catch (caught) {
                setState('proposed')
                throw caught
              }
            })}>
            {saving ? '确认存入' : '确认执行'}
          </button>
        )}
        {state === 'working' && <span className="assistant-data-note">正在执行…</span>}
        {state === 'done' && (
          <>
            <span className="assistant-data-note">
              {saving ? `已存入 ${saved} 张${undo?.skipped ? `，${undo.skipped} 张已在资产库里，跳过` : ''}。` : '已完成。'}
            </span>
            {undo && (
              <button type="button" className="assistant-commerce-link"
                onClick={() => run(async () => {
                  await undoAssistantAssetAction(undo)
                  setState('undone')
                })}>
                撤销
              </button>
            )}
            <Link className="assistant-commerce-link" to="/assets">打开资产库</Link>
          </>
        )}
        {state === 'undone' && <span className="assistant-data-note">{saving ? '已撤销，存入的图片已移到回收站。' : '已撤销，素材恢复到原来的状态。'}</span>}
      </div>
      {error && <p className="assistant-commerce-error" role="alert">{error}</p>}
    </section>
  )
}
