function finitePoints(value) {
  if (value === null || value === undefined || value === '') return null
  const points = Number(value)
  return Number.isFinite(points) && points >= 0 ? Math.round(points) : null
}

export function resolveModelPointPricing(model = {}) {
  const pricing = model?.pricing && typeof model.pricing === 'object' ? model.pricing : {}
  const effective = finitePoints(
    model?.pricePoints ?? model?.creditCost ?? pricing.points ?? model?.priceCents ?? pricing.cents,
  )
  const standard =
    finitePoints(
      model?.standardPricePoints ?? model?.standardPriceCents ?? pricing.standardPoints,
    ) ?? effective
  const discount = finitePoints(
    model?.discountPricePoints ?? model?.discountPriceCents ?? pricing.discountPoints,
  )
  return {
    standard,
    discount,
    effective: discount ?? effective ?? standard,
    hasDiscount: discount !== null && standard !== null && discount < standard,
    configured: standard !== null || discount !== null || effective !== null,
  }
}

export function formatModelPointOption(model, { perImage = true } = {}) {
  const price = resolveModelPointPricing(model)
  if (!price.configured) return ''
  const suffix = perImage ? '/张' : ''
  const timed = resolvePriceAdjustment(model)
  if (timed) return `${price.effective} 积分${suffix} · ${timed.label}`
  if (price.hasDiscount) {
    return `折扣 ${price.discount} 积分${suffix} · 标准 ${price.standard} 积分${suffix}`
  }
  if (price.effective === 0) return '免费'
  return `${price.effective} 积分${suffix}`
}

function tierCells(model) {
  const matrix = model?.imagePricing;
  if (!matrix || typeof matrix !== 'object') return [];
  return Object.values(matrix).flatMap((row) => (row && typeof row === 'object' ? Object.values(row) : []));
}

// 精确尺寸按像素数归档，与服务端一致：≤1536×1024 为 1K，≤2048×2048 为 2K，其余 4K。
function resolutionTierForPixels(width, height) {
  const pixels = width * height
  if (pixels <= 1536 * 1024) return '1K'
  if (pixels <= 2048 * 2048) return '2K'
  return '4K'
}

// 分档定价模型（分辨率 × 质量）按所选档位取价；未分档的模型保持原有单价。
export function resolveModelTierPointPricing(model = {}, { resolution = '', quality = '', exactWidth = 0, exactHeight = 0 } = {}) {
  const matrix = model?.imagePricing;
  if (!matrix || typeof matrix !== 'object') return resolveModelPointPricing(model);
  const resolutions = Array.isArray(model.resolutions) ? model.resolutions.map((item) => String(item).toUpperCase()) : [];
  const width = Number(exactWidth) || 0
  const height = Number(exactHeight) || 0
  const tier = width > 0 && height > 0
    ? resolutionTierForPixels(width, height)
    : String(resolution || '').toUpperCase() || (resolutions.includes('1K') || !resolutions.length ? '1K' : resolutions[0]);
  const cell = matrix?.[tier]?.[quality || model.defaultQuality];
  if (!cell) return resolveModelPointPricing(model);
  return resolveModelPointPricing({
    pricePoints: cell.discountPriceCents ?? cell.priceCents,
    standardPricePoints: cell.priceCents,
    discountPricePoints: cell.discountPriceCents,
  });
}

// 分档定价模型的价格区间；未分档返回 null。
export function modelPointPriceRange(model = {}) {
  const prices = tierCells(model)
    .map((cell) => finitePoints(cell?.discountPriceCents ?? cell?.priceCents))
    .filter((value) => value !== null);
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function beijingEndText(value) {
  const at = Date.parse(value || '')
  if (!Number.isFinite(at)) return ''
  const shifted = new Date(at + 8 * 3600_000).toISOString()
  return `${shifted.slice(5, 10)} ${shifted.slice(11, 16)}`
}

// 动态调价：服务端在模型上给出此刻命中的规则（priceAdjustment），价格本身已经是调整后的。
// 返回用于「限时调价」标签的文案；没有调价或幅度为 0 时返回 null。
export function resolvePriceAdjustment(model = {}) {
  const adjustment = model?.priceAdjustment
  const value = Number(adjustment?.value)
  if (!adjustment || !Number.isFinite(value) || value === 0) return null
  const endsAt = Date.parse(adjustment.endsAt || '')
  if (Number.isFinite(endsAt) && endsAt <= Date.now()) return null
  const amount = Math.abs(value)
  const delta = adjustment.mode === 'points' ? `${amount} 积分` : `${amount}%`
  const direction = value < 0 ? 'down' : 'up'
  const end = beijingEndText(adjustment.endsAt)
  return {
    direction,
    label: `限时${direction === 'down' ? '降' : '涨'} ${delta}`,
    short: `${direction === 'down' ? '−' : '+'}${delta}`,
    title: [adjustment.ruleName, end ? `至 ${end}（北京时间）` : ''].filter(Boolean).join(' · '),
  }
}

// 有限时调价时价格旁只显示「限时」标签，不再写「折扣」，划线原价照常保留。
export function hasTimedPrice(model = {}) {
  return resolvePriceAdjustment(model) !== null
}
