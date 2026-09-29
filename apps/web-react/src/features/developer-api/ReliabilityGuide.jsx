import {ExternalLink,ShieldCheck} from 'lucide-react';
import {Link} from 'react-router';
import {BILLING_RULES,ERROR_CODES} from './presentation.js';

// Billing and error rules for the /v1 gateway. The console only copies
// examples, so developers need these rules before they handle failures.
export function ReliabilityGuide(){
  return <section className="dap-panel dap-reliability" aria-labelledby="dap-reliability-title">
    <header><h3 id="dap-reliability-title"><ShieldCheck size={16}/>计费与错误</h3><span className="dap-small-label">/v1</span></header>
    <ol className="dap-rule-list">
      {BILLING_RULES.map(([title,text],index)=><li key={title}><b>{String(index+1).padStart(2,'0')}</b><div><strong>{title}</strong><p>{text}</p></div></li>)}
    </ol>
    <div className="dap-table-wrap"><table className="dap-error-table"><thead><tr><th>HTTP</th><th>错误码</th><th>含义</th></tr></thead><tbody>
      {ERROR_CODES.map(([status,code,meaning])=><tr key={code}><td className="numeric">{status}</td><td><code>{code}</code></td><td>{meaning}</td></tr>)}
    </tbody></table></div>
    <footer className="dap-panel-note">所有失败都不扣费、不计入 Key 额度。<Link to="/developer-api/docs">完整说明 <ExternalLink size={13}/></Link></footer>
  </section>;
}
