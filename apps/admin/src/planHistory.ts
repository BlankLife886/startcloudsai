export type PlanSnapshot = Record<string, any>;
export interface PlanHistoryEntry {
  revision: number; snapshot: PlanSnapshot; previous: PlanSnapshot | null;
  previousRevision: number | null; createdAt: string; actorId: string | null;
  actorName: string | null; action: string; current: boolean; orderCount: number;
}
export interface PlanChange { key: string; label: string; before: string; after: string; changed: boolean }

const labels: Record<string, string> = {
  name:'套餐名称', code:'套餐编码', description:'套餐说明', badge:'角标', kind:'套餐类型',
  price_cents:'售价', grant_cents:'基础积分', bonus_cents:'赠送积分', duration_days:'订阅天数',
  daily_grant_cents:'每24小时重置积分', active:'上架状态', recommended:'首页推荐', sort:'排序值',
  features:'展示权益', price_lock_eligible:'额度包接受订阅锁价',
  'recharge_policy.pointsPerYuan':'每元兑换积分', 'recharge_policy.priceLockMinYuan':'充值锁价门槛',
  'subscription_policy.series':'订阅系列', 'subscription_policy.tier':'订阅等级',
  'subscription_policy.channels':'使用渠道', 'subscription_policy.featureKeys':'适用场景',
  'subscription_policy.modelIds':'适用模型编号', 'subscription_policy.refundWindowHours':'退款申请时限',
  'subscription_policy.lockModelPrices':'订阅模型价格保护', 'subscription_policy.allowTopupPriceLock':'允许额度包沿用锁价',
  'subscription_policy.concurrencyBonus':'额外图片并发', 'subscription_policy.taskConcurrency':'历史任务并发',
  'subscription_policy.assistantConcurrency':'历史助手并发', 'subscription_policy.version':'权益规则版本',
};
const names: Record<string,string> = { web:'网站',api:'API',topup:'额度包',subscription:'订阅',general:'通用',text_to_image:'文生图',ai_assistant:'AI助手',ui_design:'UI设计',ecommerce_design:'电商创作',illustration_coloring:'插画上色',model_sheet:'角色设定',game_art:'游戏美术',background_remove:'背景移除',infinite_canvas:'无限画布' };
const ignored = new Set(['id','created_at','updated_at','revision']);
function flatten(snapshot: PlanSnapshot): PlanSnapshot {
  const out: PlanSnapshot = {};
  function visit(value: any, key: string) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [child, item] of Object.entries(value)) visit(item, key ? `${key}.${child}` : child);
    } else if (!ignored.has(key) && key !== 'subscription_policy' && key !== 'recharge_policy') out[key] = value;
  }
  visit(snapshot,'');
  out.customAmount = snapshot.recharge_policy != null;
  return out;
}
function canonical(value: any, key: string): string | undefined {
  return JSON.stringify(Array.isArray(value) && ['subscription_policy.channels','subscription_policy.featureKeys','subscription_policy.modelIds'].includes(key) ? [...value].sort() : value);
}
function display(key: string, value: any): string {
  if (value == null) return '未记录';
  if (key === 'active') return value ? '已上架' : '已下架';
  if (typeof value === 'boolean') return value ? '开启' : '关闭';
  if (key === 'price_cents') return `¥${(Number(value)/100).toFixed(2)}`;
  if (key.endsWith('_cents') || key.endsWith('.pointsPerYuan')) return `${Number(value).toLocaleString('zh-CN')} 积分`;
  if (key === 'duration_days') return `${value} 天`;
  if (key.endsWith('.refundWindowHours')) return `${value} 小时`;
  if (key.endsWith('.priceLockMinYuan')) return Number(value) > 0 ? `满 ¥${value}` : '不接受锁价';
  if (key.endsWith('.concurrencyBonus')) return `+${value}`;
  if (Array.isArray(value)) return value.length ? value.map(v => ['subscription_policy.channels','subscription_policy.featureKeys'].includes(key) ? names[v] || String(v) : String(v)).join('、') : key.endsWith('.featureKeys') || key.endsWith('.modelIds') ? '全部' : '无';
  if (value === '') return '未设置';
  return ['kind','subscription_policy.series'].includes(key) ? names[value] || String(value) : String(value);
}
export function planChanges(entry: PlanHistoryEntry, full = false): PlanChange[] {
  const before = flatten(entry.previous || {}), after = flatten(entry.snapshot);
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])];
  const order = ['name','kind','customAmount','price_cents','daily_grant_cents','duration_days','grant_cents','bonus_cents',...Object.keys(labels)];
  keys.sort((a,b) => (order.includes(a) ? order.indexOf(a) : 999) - (order.includes(b) ? order.indexOf(b) : 999));
  return keys.map(key => ({ key,
    label: key === 'customAmount' ? '自定义充值' : key === 'price_cents' && (before.customAmount || after.customAmount) ? '售价 / 最低充值金额' : key === 'grant_cents' && (before.customAmount || after.customAmount) ? '基础积分 / 每元积分' : labels[key] || `其他配置（${key}）`,
    before: entry.previous ? display(key,before[key]) : '—', after:display(key,after[key]),
    changed: canonical(before[key],key) !== canonical(after[key],key),
  })).filter(row => full || !entry.previous || row.changed);
}
export function versionSummary(entry: PlanHistoryEntry): string {
  if (!entry.previous) return entry.action === 'create' ? '创建套餐' : '最早保留记录';
  const changes = planChanges(entry);
  if (changes.length === 1 && changes[0]?.key === 'active') return entry.snapshot.active ? '上架套餐' : '下架套餐';
  if (changes.length === 1 && changes[0]?.key === 'sort') return '调整展示排序';
  return changes.length ? `修改${changes.slice(0,3).map(v => v.label).join('、')}${changes.length > 3 ? `等 ${changes.length} 项` : ''}` : '其他配置更新';
}
