import { getRuntimeImageModelPricing } from './aiModels'

export function getAiModelVendor(modelId, fallbackLabel = 'AI') {
  const id = String(modelId || '').toLowerCase()
  if (id.includes('claude')) return { label: 'Claude', icon: 'bi-flower1' }
  if (id.includes('gemini') || id.includes('veo')) return { label: 'Google', icon: 'bi-gem' }
  if (id.includes('grok')) return { label: 'Grok', icon: 'bi-x-diamond' }
  if (id.includes('seedream') || id.includes('seedance') || id.includes('doubao')) {
    return { label: 'ByteDance', icon: 'bi-asterisk' }
  }
  if (id.includes('kling')) return { label: 'Kling', icon: 'bi-stars' }
  if (id.includes('vidu')) return { label: 'Vidu', icon: 'bi-vimeo' }
  if (id.includes('wan') || id.includes('qwen'))
    return { label: 'Qwen', icon: 'bi-lightning-charge' }
  if (id.includes('hailuo') || id.includes('speech') || id.includes('minimax')) {
    return { label: 'MiniMax', icon: 'bi-soundwave' }
  }
  if (id.includes('flux')) return { label: 'Flux', icon: 'bi-triangle' }
  if (id.includes('ideogram')) return { label: 'Ideogram', icon: 'bi-fingerprint' }
  if (id.includes('midjourney')) return { label: 'Midjourney', icon: 'bi-sailboat' }
  if (id.includes('gpt') || id.includes('o3') || id.includes('o4') || id.includes('sora')) {
    return { label: 'OpenAI', icon: 'bi-openai' }
  }
  return { label: fallbackLabel, icon: 'bi-cpu' }
}

export function getAiModelBrand(model, fallbackLabel = 'AI') {
  if (model?.providerSlug) {
    const providerLabels = {
      bytedance: 'ByteDance',
      claude: 'Claude',
      deepseek: 'DeepSeek',
      flux: 'Flux',
      gemini: 'Gemini',
      google: 'Google',
	      gptproto: 'GPTProto',
	      zeropro: '0-0pro',
	      grok: 'Grok',
      higgsfield: 'Higgsfield',
      ideogram: 'Ideogram',
      kling: 'Kling',
      midjourney: 'Midjourney',
      minimax: 'MiniMax',
      moonshotai: 'Moonshot',
      novelai: 'NovelAI',
      openai: 'OpenAI',
      qwen: 'Qwen',
      tripo3d: 'Tripo3D',
      vidu: 'Vidu',
      'z-ai': 'Z.AI',
    }
    return {
      label: providerLabels[model.providerSlug] || model.providerSlug,
      icon: getAiModelVendor(model.id, fallbackLabel).icon,
    }
  }
  return getAiModelVendor(model?.id, fallbackLabel)
}

export function getAiModelDescription(model) {
  const raw = String(model?.description || '').trim()
  if (raw) return raw
  return 'No official description available.'
}

export function formatAiModelPriceParts(modelId, providerId = '', runtimeCatalog = null) {
  const pricing = getRuntimeImageModelPricing(modelId, providerId, runtimeCatalog)
  if (Array.isArray(pricing?.rows) && pricing.rows.length) {
    const visibleRows = pricing.rows.filter((row) => !row.isOriginal)
    const originalRows = pricing.rows.filter((row) => row.isOriginal)
    return {
      primary: visibleRows.map((row) => `${row.label} ${row.text}`).join(' · '),
      secondary: originalRows.length
        ? `原价 ${originalRows.map((row) => `${row.label} ${row.text}`).join(' · ')}`
        : pricing.note || '官网价格',
      rows: visibleRows,
      originalRows,
    }
  }
  if (!pricing?.usd) {
    return {
      primary: '费用未配置',
      secondary: pricing?.note || '以服务商账单为准',
      rows: [],
      originalRows: [],
    }
  }
  const unit = pricing.unit === 'video' ? '条' : pricing.unit === 'token' ? 'M tokens' : '张'
  return {
    primary: `$${pricing.usd.toFixed(4)} / ${unit}`,
    secondary: pricing.note || '以服务商账单为准',
    rows: [],
    originalRows: [],
  }
}

export function getAiModelPriceSummary(modelId, providerId = '', runtimeCatalog = null) {
  const parts = formatAiModelPriceParts(modelId, providerId, runtimeCatalog)
  if (parts.rows?.length) {
    const primaryRows = parts.rows.filter((row) =>
      ['textInput', 'textOutput', 'perRequest', 'perMinute'].includes(row.key),
    )
    const compactRows = primaryRows.length ? primaryRows : parts.rows
    return compactRows
      .slice(0, 2)
      .map((row) => `${row.label} ${row.text}`)
      .join(' / ')
  }
  return parts.primary
}
