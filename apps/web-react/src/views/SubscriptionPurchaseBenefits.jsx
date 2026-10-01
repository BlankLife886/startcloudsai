import { formatPoints } from '../legacy-modules/services/billingApi.js';
import { subscriptionRefundHours } from './subscriptionTerms.js';

const names = {web:'网站',api:'API',text_to_image:'文生图',ai_assistant:'AI助手',ui_design:'UI设计',ecommerce_design:'电商创作',illustration_coloring:'插画上色',model_sheet:'角色设定',game_art:'游戏美术',background_remove:'背景移除',infinite_canvas:'无限画布'};

export function SubscriptionPurchaseBenefits({plan,t}) {
  const policy=plan.subscriptionPolicy || {};
  const lock=policy.lockModelPrices !== false;
  const scope=(values,all,translate=true)=>Array.isArray(values) ? values.length ? values.map(value=>translate ? names[value] || value : value).join('、') : all : all;
  const hours=subscriptionRefundHours(policy);
  const rows=[
    ['订阅周期',`${plan.durationDays} 天`],
    ['每天额度',formatPoints(plan.dailyGrantCents)],
    ['并发',`+${policy.concurrencyBonus ?? 0}`],
    ['价格保护',lock ? policy.allowTopupPriceLock ? '订阅及合格额度包锁价' : '仅订阅积分锁价' : '按实时模型价格计费'],
    ['适用模型',scope(policy.modelIds,'全部模型',false)],
    ['使用渠道',scope(policy.channels ?? ['web','api'],'无')],
    ['适用场景',scope(policy.featureKeys,'全部场景')],
  ];
  return <section className="pp-subscription-benefits" aria-label={t('本次订阅权益')}>
    <dl>{rows.map(([label,value],index)=><div key={label} className={index < 3 ? 'is-primary' : ''}><dt>{t(label)}</dt><dd>{t(value)}</dd></div>)}</dl>
    <div className="pp-subscription-rules">
      <div><strong>{t('额度重置')}</strong><p>{t('自开通时起每24小时重置，到期停止发放；不自动续费。')}</p></div>
      <div><strong>{t('退订退款')}</strong><div><p>{t('使用过订阅积分不支持自助退款。')}</p><p>{t(`${hours > 0 ? `开通后 ${hours} 小时内未使用可申请全额退款审核，超时按剩余权益核算。` : '未使用可按剩余权益申请退款审核。'}审核期间冻结订阅积分并暂停权益。`)}</p></div></div>
    </div>
  </section>;
}
