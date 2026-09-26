import { pricingFaqs } from './pricingFaqs.js';
import { rechargeAmountLimit } from './rechargeQuote.js';
import { subscriptionRefundHours } from './subscriptionTerms.js';

const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const number = value => value.toLocaleString('zh-CN');
const name = plan => plan.name || '未命名方案';
const field = (label, value) => ({ label, value });
const unknown = '规则暂未确认，请查看购买确认页';

function refundText(policy) {
  if (!policy) return unknown;
  const hours = subscriptionRefundHours(policy);
  if (hours === null) return unknown;
  return hours === 0 ? '未启用未使用全退窗口，按剩余权益核算' : `开通后 ${hours} 小时内未使用可申请全退审核，超时按剩余权益核算`;
}

function protectionText(policy) {
  if (!policy) return unknown;
  return policy.lockModelPrices === false ? '模型按实时价格计费' : policy.allowTopupPriceLock ? '订阅及合格额度包享价格保护' : '仅订阅积分享价格保护';
}

function rechargeFacts(plans) {
  return plans.filter(p => p.kind === 'topup' && p.rechargePolicy).map(plan => {
    const rate = plan.rechargePolicy.pointsPerYuan;
    const limit = rechargeAmountLimit(plan);
    return field(name(plan), integer(rate, 1) && integer(limit, 1)
      ? `单笔 1–${number(limit)} 元（整数）；每 1 元兑换 ${number(rate)} 积分`
      : unknown);
  });
}

// Builds customer-facing facts from the same catalog as checkout. Never use the
// preview catalog or a default plan's numeric terms when a request fails.
export function buildPricingFaqs({ catalog = null, status = 'loading', subscription = null, accountConcurrency = null } = {}) {
  const ready = status === 'ready' && Array.isArray(catalog?.items);
  const plans = ready ? catalog.items.filter(p => p && p.active !== false && !p.preview) : [];
  const subscriptions = plans.filter(p => p.kind === 'subscription');
  const packs = plans.filter(p => p.kind === 'topup');
  const recharge = rechargeFacts(plans);
  const facts = {};
  const notices = {};
  const dynamicIds = ['custom-recharge', 'points-money', 'topup-protection', 'contract-pricing', 'contract-concurrency', 'buy', 'unused-refund', 'plan-difference'];
  for (const id of dynamicIds) {
    facts[id] = [];
    notices[id] = ready ? '' : status === 'loading' ? '正在读取当前规则…' : '当前规则暂时无法读取，请刷新后查看或在购买确认页核对。';
  }

  if (ready) {
    facts['custom-recharge'] = recharge;
    facts['points-money'] = recharge;
    if (!recharge.length) {
      notices['custom-recharge'] = '当前未上架自定义充值方案。';
      notices['points-money'] = '当前未上架自定义充值，固定额度包按各自标注的金额和积分购买。';
    }
    facts['topup-protection'] = packs.map(plan => {
      let value = '不接受订阅锁价，按实时模型价格消费';
      if (plan.priceLockEligible) {
        value = '有效合格订阅下可接受锁价';
        if (plan.rechargePolicy) {
          const threshold = plan.rechargePolicy.priceLockMinYuan;
          value = integer(threshold, 1) && threshold <= rechargeAmountLimit(plan)
            ? `单笔满 ${number(threshold)} 元可接受锁价，仍需有效合格订阅支持`
            : unknown;
        }
      }
      return field(name(plan), value);
    });
    if (!packs.length) notices['topup-protection'] = '当前没有在售额度包。';

    facts['unused-refund'] = subscriptions.map(plan => field(name(plan), refundText(plan.subscriptionPolicy)));
    facts['contract-pricing'] = subscriptions.map(plan => field(name(plan), protectionText(plan.subscriptionPolicy)));
    const base = catalog.baseConcurrency;
    if (integer(base, 1)) facts['contract-concurrency'].push(field('平台基础并发', `${number(base)}`));
    for (const plan of subscriptions) {
      const bonus = plan.subscriptionPolicy?.concurrencyBonus;
      facts['contract-concurrency'].push(field(name(plan), integer(bonus)
        ? `并发 +${number(bonus)}${integer(base, 1) ? `，生效后图片上限 ${number(base + bonus)}` : ''}`
        : '并发加成以购买确认页为准'));
    }
    if (!integer(base, 1)) notices['contract-concurrency'] = '平台基础并发暂未读取到，实际可用名额以账号显示为准。';
    for (const id of ['unused-refund', 'contract-pricing']) {
      if (!subscriptions.length) notices[id] = '当前没有在售订阅方案；已购权益请查看「我的订阅」。';
    }
    facts['plan-difference'] = plans.map(plan => field(name(plan), plan.kind === 'subscription'
      ? integer(plan.durationDays, 1) && integer(plan.dailyGrantCents) ? `完整 ${number(plan.durationDays)} 天，每天重置为 ${number(plan.dailyGrantCents)} 积分` : unknown
      : plan.rechargePolicy ? '自定义金额充值，按本方案比例一次到账'
      : integer(plan.priceCents, 1) && integer(plan.grantCents) && integer(plan.bonusCents ?? 0)
        ? `¥${(plan.priceCents / 100).toFixed(2)}，一次到账 ${number(plan.grantCents + (plan.bonusCents ?? 0))} 积分` : unknown));
    if (!plans.length) notices['plan-difference'] = '当前没有在售方案。';

    const methods = [...new Set((Array.isArray(catalog.paymentMethods) ? catalog.paymentMethods : []).filter(m => ['alipay', 'wechat'].includes(m)))];
    facts.buy = [field('当前支付状态', catalog.paymentEnabled === false ? '暂未开放在线购买'
      : catalog.paymentEnabled === true && methods.length
        ? `支持${methods.map(m => m === 'alipay' ? '支付宝' : '微信支付').join('、')}` : '支付方式暂未确认，请在购买时核对')];
    if (!plans.length) facts.buy.push(field('在售方案', '暂无在售套餐'));
  }

  const purchased = {};
  if (subscription) {
    const label = `已购记录 · ${subscription.planName || '我的订阅'}`;
    if (subscription.billingVersion === 2 && subscription.policy) {
      purchased['unused-refund'] = [field(label, refundText(subscription.policy))];
      purchased['contract-pricing'] = [field(label, protectionText(subscription.policy))];
      const bonus = subscription.policy.concurrencyBonus;
      purchased['contract-concurrency'] = [field(label, integer(bonus) ? `购买时并发加成 +${number(bonus)}` : '以购买时记录的并发加成为准')];
    } else {
      for (const id of ['unused-refund', 'contract-pricing', 'contract-concurrency']) {
        purchased[id] = [field(label, '历史权益请到「我的订阅」查看，不套用当前在售方案规则')];
      }
    }
  }
  if (accountConcurrency && integer(accountConcurrency.imageLimit, 1) && integer(accountConcurrency.chatLimit, 1)) {
    purchased['contract-concurrency'] = [...(purchased['contract-concurrency'] || []), field('当前账号实际名额', `图片 ${number(accountConcurrency.imageLimit)}，对话 ${number(accountConcurrency.chatLimit)}`)];
  }

  return pricingFaqs.map(item => ({ ...item, facts: facts[item.id] || [], notice: notices[item.id] || '', purchasedFacts: purchased[item.id] || [],
    purchasedTitle: subscription ? '你的已购权益' : '当前账号名额',
    purchasedNote: subscription ? '以上已购规则不随在售套餐调整。退款资格以实际消费及申请页核定为准；并发和价格保护仅在相应权益生效时提供。' : '名额以当前账号状态为准，仍受平台及上游容量限制。',
  }));
}
