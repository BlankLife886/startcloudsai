import { useMemo } from 'react';
import { PageEntryLink as Link } from '../page-control/PageEntryLink.jsx';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import documentation from '../../../../docs/OPEN_API.md?raw';
import './open-api-docs.css';
export function OpenAPIDocsView(){
  const html=useMemo(()=>DOMPurify.sanitize(marked.parse(documentation)),[]);
  return <div className="open-api-docs"><nav><Link to="/developer-api">开发者控制台</Link><span> / API 文档</span></nav><article dangerouslySetInnerHTML={{__html:html}}/></div>;
}
