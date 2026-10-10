import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { PageEntryLink as Link } from '../page-control/PageEntryLink.jsx';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import documentation from '../../../../docs/OPEN_API.md?raw';
import { useIsDark } from '../hooks/useIsDark.js';
import './open-api-docs.css';

// renderDocs turns the Markdown into sanitized HTML and gives every section
// heading an id for the table of contents. Code blocks get a language label
// and a copy button; tables scroll on their own so the page never does.
function renderDocs(markdown) {
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(marked.parse(markdown)), 'text/html');
  const toc = [];
  const title = doc.querySelector('h1');
  title?.remove();
  doc.querySelectorAll('h2, h3').forEach((heading, index) => {
    heading.id = `section-${index + 1}`;
    toc.push({ id: heading.id, text: heading.textContent, level: heading.tagName === 'H2' ? 2 : 3 });
  });
  doc.querySelectorAll('pre').forEach((pre) => {
    const language = pre.querySelector('code')?.className.match(/language-(\w+)/)?.[1] || 'text';
    const block = doc.createElement('div');
    block.className = 'oad-code';
    const header = doc.createElement('div');
    header.className = 'oad-code-head';
    const label = doc.createElement('span');
    label.textContent = { bash: 'Shell', python: 'Python', js: 'JavaScript', json: 'JSON' }[language] || language;
    const copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'oad-copy';
    copy.textContent = '复制';
    header.append(label, copy);
    pre.replaceWith(block);
    block.append(header, pre);
  });
  doc.querySelectorAll('table').forEach((table) => {
    const wrap = doc.createElement('div');
    wrap.className = 'oad-table';
    table.replaceWith(wrap);
    wrap.append(table);
  });
  doc.querySelectorAll('a[href^="http"]').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  return { title: title?.textContent || 'API 文档', html: doc.body.innerHTML, toc };
}

export function OpenAPIDocsView() {
  const isDark = useIsDark();
  const { title, html, toc } = useMemo(() => renderDocs(documentation), []);
  const articleRef = useRef(null);
  const [active, setActive] = useState(toc[0]?.id || '');

  // Highlight the section being read in the table of contents.
  useEffect(() => {
    const headings = toc.map((item) => document.getElementById(item.id)).filter(Boolean);
    if (!headings.length || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '-90px 0px -65% 0px' });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [toc]);

  const onArticleClick = async (event) => {
    const button = event.target.closest?.('.oad-copy');
    if (!button) return;
    const code = button.closest('.oad-code')?.querySelector('pre')?.innerText || '';
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = '已复制';
    } catch {
      button.textContent = '复制失败';
    }
    window.setTimeout(() => { button.textContent = '复制'; }, 1600);
  };

  const jump = (event, id) => {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <main className={`oad${isDark ? ' is-dark' : ''}`}>
      <div className="oad-shell">
        <aside className="oad-side" aria-label="文档目录">
          <Link to="/developer-api" className="oad-back"><ArrowLeft size={15} />API 调用控制台</Link>
          <p className="oad-side-label">目录</p>
          <nav>
            {toc.map((item) => (
              <a key={item.id} href={`#${item.id}`} className={`is-l${item.level}${active === item.id ? ' active' : ''}`} onClick={(event) => jump(event, item.id)}>{item.text}</a>
            ))}
          </nav>
        </aside>
        <div className="oad-main">
          <header className="oad-hero">
            <span className="oad-hero-icon" aria-hidden="true"><BookOpen size={20} /></span>
            <div>
              <p className="oad-eyebrow">OpenAI 兼容 · /v1</p>
              <h1>{title}</h1>
            </div>
          </header>
          <article ref={articleRef} className="oad-article" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </main>
  );
}
