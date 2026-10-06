// 竞品风格拆解卡片：“照着竞品做”时，助手从竞品截图里拆出的打法（图片顺序、配色、光线、
// 文字排版、文案写法）。只借鉴风格，竞品截图不会交给出图模型。
import { useState } from 'react'
import './assistant-competitor-style.css'

const SLOTS_COLLAPSED = 6
const DETAIL_ROWS = [
  ['lighting', '光线'],
  ['background', '背景与场景'],
  ['typography', '字体与排版'],
  ['textDensity', '文字多少'],
  ['props', '道具与元素'],
]

export function AssistantCompetitorStyle({ data, messageId = '', actions = null }) {
  const [showAllSlots, setShowAllSlots] = useState(false)
  const [sent, setSent] = useState(false)
  const style = data?.style || {}
  const images = Array.isArray(data?.images) ? data.images : []
  const slots = Array.isArray(data?.slots) ? data.slots : []
  const palette = Array.isArray(style.palette) ? style.palette : []
  const meta = [style.platform, style.category, slots.length ? `${slots.length} 张图` : ''].filter(Boolean).join(' · ')
  const canSend = Boolean(actions?.send) && actions.lastAssistantId === messageId && !actions.busy && !sent

  if (style.notListing) {
    return (
      <section className="assistant-data assistant-competitor" aria-label="竞品风格拆解">
        <header className="assistant-competitor-head">
          <strong>没有识别出竞品商品图</strong>
          <span>{style.reason || '请发竞品的主图或详情页截图'}</span>
        </header>
      </section>
    )
  }

  const visibleSlots = showAllSlots ? slots : slots.slice(0, SLOTS_COLLAPSED)
  const send = () => {
    setSent(true)
    actions.send(messageId, '按这个竞品的风格，给我的商品出一套方案')
  }
  return (
    <section className="assistant-data assistant-competitor" aria-label="竞品风格拆解">
      <header className="assistant-competitor-head">
        <strong>竞品风格拆解</strong>
        {meta && <span>{meta}</span>}
      </header>
      {style.summary && <p className="assistant-competitor-summary">{style.summary}</p>}
      {images.length > 0 && (
        <ul className="assistant-competitor-shots" aria-label="竞品截图">
          {images.map((image, index) => (
            <li key={image.url}>
              <a href={image.url} target="_blank" rel="noreferrer" aria-label={`查看第 ${index + 1} 张竞品截图`}>
                <img src={image.url} alt="" loading="lazy" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {palette.length > 0 && (
        <div className="assistant-competitor-section">
          <h4>配色</h4>
          <ul className="assistant-competitor-palette">
            {palette.map((color) => (
              <li key={`${color.hex}-${color.name}`} title={color.role || color.name}>
                <i style={{ background: color.hex }} aria-hidden="true" />
                <span>{color.name}</span>
                <code>{color.hex}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="assistant-competitor-rows">
        {DETAIL_ROWS.filter(([key]) => style[key]).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{style[key]}</dd>
          </div>
        ))}
      </dl>
      {slots.length > 0 && (
        <div className="assistant-competitor-section">
          <h4>图片顺序与版式</h4>
          <ol className="assistant-competitor-slots">
            {visibleSlots.map((slot, index) => (
              <li key={`${slot.type}-${index}`}>
                <span className="assistant-competitor-slot-index">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{slot.label}<em>{slot.purpose}</em></strong>
                  <p>{slot.layout}</p>
                  {slot.copyPattern && <p className="is-copy">文案：{slot.copyPattern}</p>}
                </div>
              </li>
            ))}
          </ol>
          {slots.length > SLOTS_COLLAPSED && (
            <button type="button" className="assistant-competitor-more" onClick={() => setShowAllSlots((value) => !value)}>
              {showAllSlots ? '收起' : `展开全部 ${slots.length} 张`}
            </button>
          )}
        </div>
      )}
      {(style.strengths?.length > 0 || style.improvements?.length > 0) && (
        <div className="assistant-competitor-takeaways">
          {style.strengths?.length > 0 && (
            <div>
              <h4>值得借鉴</h4>
              <ul>{style.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {style.improvements?.length > 0 && (
            <div>
              <h4>可以做得更好</h4>
              <ul>{style.improvements.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      <p className="assistant-competitor-note">
        <i className="bi bi-shield-check" aria-hidden="true" />
        只借鉴风格和打法，竞品截图不会拿去出图；商品外观以你自己的商品图为准
        {style.avoidTerms?.length > 0 ? `，并避开「${style.avoidTerms.slice(0, 4).join('」「')}」等竞品品牌和文案` : ''}。
      </p>
      {canSend && (
        <footer className="assistant-competitor-foot">
          <button type="button" onClick={send}>
            <i className="bi bi-magic" aria-hidden="true" />按这个风格给我的商品出方案
          </button>
        </footer>
      )}
    </section>
  )
}
