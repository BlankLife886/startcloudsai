export function upgradeBlockReason(subscription, plan, changes = []) {
  if (!subscription || subscription.status !== 'active') return '当前订阅已结束或正在退订，请前往我的订阅确认状态。';
  if (subscription.upgrading || changes.some(change => change.subscriptionId === subscription.id && ['pending','reviewing','processing'].includes(change.status))) return '已有订阅变更处理中，请先完成或取消原申请。';
  if (!subscription.canChange) return '当前订阅暂不支持自助升级，请联系支持核查。';
  if (plan.id === subscription.planId) return '当前订阅';
  const next = plan.subscriptionPolicy, old = subscription.policy;
  if (plan.preview || plan.kind !== 'subscription' || !next || !old || !next.series || next.series !== old.series) return '该方案属于不同订阅系列，不支持从当前订阅直接升级。';
  if (!(next.tier > old.tier) || !(plan.dailyGrantCents > subscription.dailyPoints)) return '升级方案的等级和每天额度都须高于当前订阅。';
  const covers = (a = [], b = [], all = false) => all && !a.length || !(all && !b.length) && b.every(value => a.includes(value));
  if (!covers(next.channels, old.channels) || !covers(next.featureKeys, old.featureKeys, true) || !covers(next.modelIds, old.modelIds, true)) return '该方案未覆盖当前订阅的全部渠道、场景或模型范围。';
  const rights = subscription.contract;
  if (rights && (next.concurrencyBonus ?? 0) < (rights.concurrencyBonus ?? 0)) return '该方案的额外并发低于当前订阅，无法直接升级。';
  if (rights && (rights.lockModelPrices && !next.lockModelPrices || rights.allowTopupPriceLock && !next.allowTopupPriceLock)) return '该方案未覆盖当前订阅的锁价权益，无法直接升级。';
  return '';
}

export function upgradeComparison(snapshot = {}) {
  const source = snapshot.sourcePlan || {};
  const number = (value, unit, positive = false) => typeof value === 'number' && Number.isFinite(value) && value >= (positive ? 1 : 0)
    ? `${value.toLocaleString('zh-CN')}${unit}` : '未记录';
  const concurrency = rights => typeof rights?.concurrencyBonus === 'number' ? `+${rights.concurrencyBonus}` : '未记录';
  const protection = rights => {
    if (typeof rights?.lockModelPrices !== 'boolean') return '未记录';
    if (!rights.lockModelPrices) return '按实时价格';
    if (typeof rights.allowTopupPriceLock !== 'boolean') return '已锁价，范围未记录';
    return rights.allowTopupPriceLock ? '订阅及合格额度包' : '仅订阅积分';
  };
  const price = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `¥${(value / 100).toFixed(2)}` : '未记录';
  const rows = [
    { key:'price', label:'套餐价格', before:price(source.priceCents), after:price(snapshot.priceCents) },
    { key:'daily', label:'每天额度', before:number(source.dailyPoints,' 积分'), beforeDisplay:number(source.dailyPoints,''), after:number(snapshot.dailyPoints,' 积分') },
    { key:'duration', label:'套餐周期', before:number(source.durationDays,' 天',true), after:number(snapshot.durationDays,' 天',true) },
    { key:'concurrency', label:'并发', before:concurrency(source.contract), after:concurrency(snapshot.contract) },
    { key:'protection', label:'锁价范围', before:protection(source.contract), after:protection(snapshot.contract) },
  ];
  const sceneNames = { web:'网站', api:'API', text_to_image:'文生图', ai_assistant:'AI助手', ui_design:'UI设计', ecommerce_design:'电商创作', illustration_coloring:'插画上色', model_sheet:'角色设定', game_art:'游戏美术', background_remove:'背景移除', infinite_canvas:'无限画布' };
  for (const [key,label,all] of [['channels','使用渠道','无'],['featureKeys','适用场景','全部场景'],['modelIds','适用模型','全部模型']]) {
    const before = source.policy?.[key], after = snapshot.policy?.[key];
    if (!Array.isArray(before) && !Array.isArray(after)) continue;
    const display = values => !Array.isArray(values) ? '未记录' : values.length ? [...values].sort().map(value => key === 'modelIds' ? value : sceneNames[value] || value).join('、') : all;
    rows.push({key,label,before:display(before),after:display(after)});
  }
  return rows.filter(row => row.before !== '未记录' || row.after !== '未记录')
    .map(row => ({...row,changed:row.before !== '未记录' && row.after !== '未记录' && row.before !== row.after}));
}
