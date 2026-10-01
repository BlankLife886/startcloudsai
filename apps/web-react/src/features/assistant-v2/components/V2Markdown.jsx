import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

// isInAppPath accepts "/wallet" or "/assistant?c=1" but never "//evil.com".
export function isInAppPath(href) {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')
}

export function renderV2Markdown(content) {
  const html = DOMPurify.sanitize(marked.parse(String(content || ''), { async: false, breaks: true, gfm: true }), {
    USE_PROFILES: { html: true },
  })
  if (typeof document === 'undefined') return html
  const root = document.createElement('div')
  root.innerHTML = html
  root.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href') || ''
    if (isInAppPath(href)) {
      link.dataset.inApp = 'true'
      link.removeAttribute('target')
    } else {
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
    }
  })
  return root.innerHTML
}

export function V2Markdown({ content, className = '' }) {
  const navigate = useNavigate()
  const html = useMemo(() => renderV2Markdown(content), [content])
  const onClick = (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[data-in-app="true"]') : null
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    navigate(link.getAttribute('href'))
  }
  // eslint-disable-next-line react/no-danger -- sanitized by DOMPurify above
  return <div className={`av2-markdown ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
