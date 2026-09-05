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
  if (price.hasDiscount) {
    return `折扣 ${price.discount} 积分${suffix} · 标准 ${price.standard} 积分${suffix}`
  }
  if (price.effective === 0) return '免费'
  return `${price.effective} 积分${suffix}`
}
