import {useEffect,useState} from 'react';
import {Link} from 'react-router';
import {ChevronRight,SquareTerminal} from 'lucide-react';
import {apiGet} from '../../legacy-modules/services/apiClient.js';
import './ApiUsageSummary.css';

// API charges are kept out of wallet history, so the wallet and subscription
// pages show this month's API total with a link to the call history. Nothing
// renders when there were no API calls this month.
export function ApiUsageSummary({className=''}){
 const [summary,setSummary]=useState(null);
 useEffect(()=>{
  const controller=new AbortController();
  apiGet('/me/api-usage-summary',{signal:controller.signal,fallbackMessage:'API 消耗读取失败'}).then(setSummary).catch(()=>{});
  return()=>controller.abort();
 },[]);
 if(!summary||!Number(summary.monthCalls))return null;
 return <div className={`api-usage-summary ${className}`}>
  <span className="api-usage-summary__icon"><SquareTerminal size={16} aria-hidden="true"/></span>
  <div className="api-usage-summary__body">
   <strong>API 调用本月消耗 <b>{Number(summary.monthPoints).toLocaleString('zh-CN')}</b> 积分</strong>
   <small>{Number(summary.monthCalls).toLocaleString('zh-CN')} 次调用 · 不计入积分明细</small>
  </div>
  <Link to="/developer-api?tab=calls">调用记录<ChevronRight size={14} aria-hidden="true"/></Link>
 </div>;
}
