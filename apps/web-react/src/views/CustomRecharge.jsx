import { ShieldCheck } from 'lucide-react';
import { rechargeAmountLimit } from './rechargeQuote.js';

export function CustomRecharge({ plan, onChange, disabled, t }) {
  const policy = plan.rechargePolicy;
  const amount = plan.rechargeAmountYuan;
  const valid = amount != null && amount >= 1;
  const limit = rechargeAmountLimit(plan);
  return <div className="pp-recharge-fields">
      <label htmlFor={`recharge-${plan.id}`}>{t('充值金额（元）')}</label>
      <div className="pp-recharge__input"><span aria-hidden="true">¥</span><input id={`recharge-${plan.id}`} aria-label={t('充值金额（元）')} placeholder={t('输入充值金额')} inputMode="numeric" type="text" autoComplete="off" maxLength={8} value={plan.rechargeInput ?? String(amount ?? '')} disabled={disabled} onChange={event => onChange(event.target.value)} aria-invalid={!valid} aria-describedby={`recharge-limit-${plan.id}`} /></div>
      <small id={`recharge-limit-${plan.id}`} className={!valid ? 'is-error' : ''}>{t(valid ? `1 元起充，最高 ${limit.toLocaleString('zh-CN')} 元，仅支持整数` : `请输入 1–${limit.toLocaleString('zh-CN')} 元的整数金额`)}</small>
      <div className="pp-recharge__presets" role="group" aria-label={t('快捷充值金额')}>
        {[1, 10, 30, 100, 300].filter(n => n <= limit).map(n => <button type="button" key={n} aria-pressed={valid && amount === n} disabled={disabled} onClick={() => onChange(String(n))}>¥{n}</button>)}
      </div>
      <div className="pp-recharge__protection"><ShieldCheck size={17} aria-hidden="true" /><div><span>{t(plan.priceLockEligible ? `单笔满 ${policy.priceLockMinYuan} 元可接受订阅锁价` : '本充值方案不接受订阅锁价')}</span>{plan.priceLockEligible && <small> · {t('需有效订阅支持')}</small>}</div>{valid && plan.priceLockEligible && <em className={plan.rechargeEligible ? 'is-eligible' : ''}>{t(plan.rechargeEligible ? '金额已达标' : '金额未达标')}</em>}</div>
  </div>;
}
