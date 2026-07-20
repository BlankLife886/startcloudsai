export function createPricingModelHelpers(dependencies) {
  const {
    formatMoneyDisplay,
    formatUsd,
    modelSearch,
    modelCapabilityFilter,
    modelBillingFilter,
    modelProviderFilter,
  } = dependencies

  function publicModelId(model) {
    return String(model?.publicModelKey || model?.id || '').trim()
  }

  function publicModelApiId(model) {
    return String(
      model?.apiModelId || model?.externalModelId || model?.modelId || publicModelId(model),
    ).trim()
  }

  function readPublicModelTokenPricing(model) {
    const metadata =
      model?.metadata && typeof model.metadata === 'object' && !Array.isArray(model.metadata)
        ? model.metadata
        : {}
    const pricing =
      metadata.pricing && typeof metadata.pricing === 'object' && !Array.isArray(metadata.pricing)
        ? metadata.pricing
        : {}
    const token =
      pricing.token && typeof pricing.token === 'object' && !Array.isArray(pricing.token)
        ? pricing.token
        : {}
    const user =
      pricing.user && typeof pricing.user === 'object' && !Array.isArray(pricing.user)
        ? pricing.user
        : {}
    const legacy = Number(model?.userPriceUsd || 0)
    const input = Number(
      user.inputUsdPerMillionTokens ??
        user.inputUsdPerMToken ??
        token.inputUsdPerMillionTokens ??
        token.inputUsdPerMToken ??
        legacy,
    )
    const output = Number(
      user.outputUsdPerMillionTokens ??
        user.outputUsdPerMToken ??
        token.outputUsdPerMillionTokens ??
        token.outputUsdPerMToken ??
        input,
    )
    const cachedInput = Number(
      user.cachedInputUsdPerMillionTokens ??
        user.cachedInputUsdPerMToken ??
        user.cachedInputPricePerMillionTokens ??
        user.cachedInputPricePerMToken ??
        user.cacheUsdPerMToken ??
        user.cachePricePerMToken ??
        user.cacheReadUsdPerMillionTokens ??
        user.cacheReadUsdPerMToken ??
        user.cacheReadPricePerMillionTokens ??
        user.cacheReadPricePerMToken ??
        token.cachedInputUsdPerMillionTokens ??
        token.cachedInputUsdPerMToken ??
        token.cachedInputPricePerMillionTokens ??
        token.cachedInputPricePerMToken ??
        token.cacheUsdPerMToken ??
        token.cachePricePerMToken ??
        token.cacheReadUsdPerMillionTokens ??
        token.cacheReadUsdPerMToken ??
        token.cacheReadPricePerMillionTokens ??
        token.cacheReadPricePerMToken ??
        0,
    )
    return {
      input: Number.isFinite(input) ? input : 0,
      output: Number.isFinite(output) ? output : 0,
      cachedInput: Number.isFinite(cachedInput) ? cachedInput : 0,
    }
  }

  function formatModelUnitPrice(model, billingModeRaw = 'request') {
    const amount = Number(model?.userPriceUsd || 0)
    if (!amount) return '—'
    const unitMap = {
      image: '/张',
      minute: '/分钟',
      second: '/秒',
      storage: '/GB',
    }
    const unit = unitMap[String(billingModeRaw || '')] || '/次'
    return `${formatMoneyDisplay(amount)}${unit}`
  }

  function formatCompactUsd(value) {
    return formatUsd(value)
  }

  function formatModelIoPrice(model) {
    if (model.billingModeRaw === 'token') {
      if (model.inputPrice <= 0 && model.outputPrice <= 0) return '未配置'
      return `${formatCompactUsd(model.inputPrice)} / ${formatCompactUsd(model.outputPrice)}`
    }
    if (model.billingModeRaw === 'credit') {
      return formatModelUnitPrice(model.raw, 'request')
    }
    return formatModelUnitPrice(model.raw, model.billingModeRaw)
  }

  function readModelPricingMeta(model = {}) {
    const metadata =
      model?.metadata && typeof model.metadata === 'object' && !Array.isArray(model.metadata)
        ? model.metadata
        : {}
    const pricing =
      metadata.pricing && typeof metadata.pricing === 'object' && !Array.isArray(metadata.pricing)
        ? metadata.pricing
        : {}
    const official =
      pricing.official && typeof pricing.official === 'object' && !Array.isArray(pricing.official)
        ? pricing.official
        : pricing.reference &&
            typeof pricing.reference === 'object' &&
            !Array.isArray(pricing.reference)
          ? pricing.reference
          : {}
    return { metadata, pricing, official }
  }

  const PUBLIC_MODEL_CACHE_PRICE_KEYS = [
    'cachedInputUsdPerMillionTokens',
    'cachedInputUsdPerMToken',
    'cachedInputPricePerMillionTokens',
    'cachedInputPricePerMToken',
    'cacheUsdPerMToken',
    'cachePricePerMToken',
    'cacheReadUsdPerMillionTokens',
    'cacheReadUsdPerMToken',
    'cacheReadPricePerMillionTokens',
    'cacheReadPricePerMToken',
  ]

  function hasPositivePricingField(source = {}, keys = []) {
    return keys.some((key) => {
      const value = Number(source?.[key])
      return Number.isFinite(value) && value > 0
    })
  }

  function hasPublicModelCachePricing(model = {}) {
    const { pricing } = readModelPricingMeta(model)
    const user =
      pricing.user && typeof pricing.user === 'object' && !Array.isArray(pricing.user)
        ? pricing.user
        : {}
    const token =
      pricing.token && typeof pricing.token === 'object' && !Array.isArray(pricing.token)
        ? pricing.token
        : {}
    return (
      hasPositivePricingField(user, PUBLIC_MODEL_CACHE_PRICE_KEYS) ||
      hasPositivePricingField(token, PUBLIC_MODEL_CACHE_PRICE_KEYS)
    )
  }

  function readOfficialInputPrice(model = {}) {
    const { official } = readModelPricingMeta(model)
    return Number(official.inputUsdPerMillionTokens ?? official.inputUsdPerMToken ?? 0)
  }

  function formatModelCardPriceAmount(value) {
    const amount = Number(value || 0)
    if (!Number.isFinite(amount) || amount <= 0) return ''
    let formatted
    if (amount >= 1) formatted = amount.toFixed(1).replace(/\.0$/, '')
    else if (amount >= 0.1) formatted = amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    else formatted = amount.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
    return `$${formatted}`
  }

  function buildModelMarketLine(model = {}) {
    const market = readOfficialInputPrice(model)
    const discount = readModelDiscountLabel(model)
    if (market > 0 && discount) {
      return {
        market: formatModelCardPriceAmount(market),
        discount,
      }
    }
    return null
  }

  function buildModelCardPriceLines(billingModeRaw = 'request', tokenPricing = {}, model = {}) {
    if (String(billingModeRaw || '') !== 'token') return []
    const input = Number(tokenPricing.input || 0)
    const output = Number(tokenPricing.output || 0)
    const cache = Number(tokenPricing.cachedInput || 0)
    const showCache = hasPublicModelCachePricing(model) && cache > 0
    if (input <= 0 && output <= 0 && !showCache) {
      return [{ key: 'empty', label: '', amount: '未配置' }]
    }
    const lines = []
    if (input > 0) {
      const amount = formatModelCardPriceAmount(input)
      if (amount) lines.push({ key: 'input', label: '输入', amount })
    }
    if (output > 0) {
      const amount = formatModelCardPriceAmount(output)
      if (amount) lines.push({ key: 'output', label: '输出', amount })
    }
    if (showCache) {
      const amount = formatModelCardPriceAmount(cache)
      if (amount) lines.push({ key: 'cache', label: '缓存', amount })
    }
    return lines
  }

  function formatModelCardPrimaryLine(model = {}) {
    if (model.billingModeRaw === 'token') {
      const input = Number(model.inputPrice || 0)
      const output = Number(model.outputPrice || 0)
      if (input <= 0 && output <= 0) return '未配置'
      const inputText = input > 0 ? formatModelCardPriceAmount(input) : '—'
      if (output > 0 && Math.abs(output - input) > 0.000001) {
        return `${inputText} · ${formatModelCardPriceAmount(output)} / 1M Tokens`
      }
      return `${inputText} / 1M Tokens`
    }
    if (model.billingModeRaw === 'credit') {
      return formatModelUnitPrice(model.raw, 'request')
    }
    return formatModelUnitPrice(model.raw, model.billingModeRaw)
  }

  function readModelDiscountLabel(model) {
    const metadata =
      model?.metadata && typeof model.metadata === 'object' && !Array.isArray(model.metadata)
        ? model.metadata
        : {}
    const promo =
      metadata.promo && typeof metadata.promo === 'object' && !Array.isArray(metadata.promo)
        ? metadata.promo
        : {}
    const direct = Number(promo.percent || promo.discountPercent || metadata.discountPercent || 0)
    if (direct > 0) return `${Math.round(direct)}% off`

    const pricing =
      metadata.pricing && typeof metadata.pricing === 'object' && !Array.isArray(metadata.pricing)
        ? metadata.pricing
        : {}
    const official =
      pricing.official && typeof pricing.official === 'object' && !Array.isArray(pricing.official)
        ? pricing.official
        : pricing.reference &&
            typeof pricing.reference === 'object' &&
            !Array.isArray(pricing.reference)
          ? pricing.reference
          : {}
    const user =
      pricing.user && typeof pricing.user === 'object' && !Array.isArray(pricing.user)
        ? pricing.user
        : {}
    const tokenPricing = readPublicModelTokenPricing(model)
    const officialInput = Number(
      official.inputUsdPerMillionTokens ?? official.inputUsdPerMToken ?? 0,
    )
    const userInput = Number(
      user.inputUsdPerMillionTokens ?? user.inputUsdPerMToken ?? tokenPricing.input ?? 0,
    )
    if (officialInput > 0 && userInput > 0 && userInput < officialInput) {
      const percent = Math.round((1 - userInput / officialInput) * 100)
      if (percent > 0) return `${percent}% off`
    }
    return ''
  }

  function readPublicModelIconUrl(model = {}) {
    const metadata =
      model?.metadata && typeof model.metadata === 'object' && !Array.isArray(model.metadata)
        ? model.metadata
        : {}
    return String(model?.iconUrl || metadata.iconUrl || metadata.icon_url || '').trim()
  }

  function buildIdleAvailabilitySegments(count = 48) {
    return Array.from({ length: count }, () => 'idle')
  }

  function splitAvailabilityRows(segments, rows = 2) {
    const list = Array.isArray(segments) ? segments.map(String) : []
    if (!list.length) return []
    const perRow = Math.ceil(list.length / rows)
    return Array.from({ length: rows }, (_, index) =>
      list.slice(index * perRow, (index + 1) * perRow),
    ).filter((row) => row.length)
  }

  function formatAvailabilityPercent(model) {
    if (model.availabilitySource === 'unavailable' || model.availabilityPercent === 0) {
      return '0%'
    }
    if (model.availabilityPercent === null || model.availabilityPercent === undefined) {
      return '暂无数据'
    }
    const value = Number(model.availabilityPercent)
    if (!Number.isFinite(value)) return '暂无数据'
    if (value >= 100) return '100%'
    return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`
  }

  function formatAvailabilityTitle(model) {
    const percent = formatAvailabilityPercent(model)
    const success = Number(model.successCount24h || 0)
    const failed = Number(model.failedCount24h || 0)
    if (model.availabilitySource === 'usage') {
      return `24h 可用性 ${percent}（成功 ${success} / 失败 ${failed}）`
    }
    if (model.availabilitySource === 'unavailable') {
      return '路由不可用或未配置可用 Key'
    }
    return '近 24h 暂无调用记录'
  }

  function clearModelFilters() {
    modelSearch.value = ''
    modelCapabilityFilter.value = 'all'
    modelBillingFilter.value = 'all'
    modelProviderFilter.value = 'all'
  }

  return {
    publicModelId,
    publicModelApiId,
    readPublicModelTokenPricing,
    formatModelUnitPrice,
    formatCompactUsd,
    formatModelIoPrice,
    readModelPricingMeta,
    PUBLIC_MODEL_CACHE_PRICE_KEYS,
    hasPositivePricingField,
    hasPublicModelCachePricing,
    readOfficialInputPrice,
    formatModelCardPriceAmount,
    buildModelMarketLine,
    buildModelCardPriceLines,
    formatModelCardPrimaryLine,
    readModelDiscountLabel,
    readPublicModelIconUrl,
    buildIdleAvailabilitySegments,
    splitAvailabilityRows,
    formatAvailabilityPercent,
    formatAvailabilityTitle,
    clearModelFilters,
  }
}
