import {useEffect,useState} from 'react';
import {Link} from 'react-router';
import {SquareTerminal} from 'lucide-react';
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
 return <p className={`api-usage-summary ${className}`}>
  <SquareTerminal size={15} aria-hidden="true"/>
  <span>开发者 API 本月消耗 <b>{Number(summary.monthPoints).toLocaleString('zh-CN')}</b> 积分（{Number(summary.monthCalls).toLocaleString('zh-CN')} 次调用），不计入积分明细</span>
  <Link to="/developer-api?tab=calls">查看调用记录</Link>
 </p>;
}
