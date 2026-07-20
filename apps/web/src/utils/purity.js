function normalizePurity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

export function purityLabel(value) {
  const purity = normalizePurity(value)
  if (purity === 'sfw' || purity === '100') return 'SFW'
  if (purity === 'sketchy' || purity === '110') return 'Sketchy'
  if (
    purity === 'nsfw' ||
    purity === '001' ||
    purity === '010' ||
    purity === '011' ||
    purity === '101'
  ) {
    return 'NSFW'
  }
  return purity ? purity.toUpperCase() : '未知'
}

export function purityTone(value) {
  const purity = normalizePurity(value)
  if (purity === 'sfw' || purity === '100') return 'safe'
  if (purity === 'sketchy' || purity === '110') return 'warn'
  if (
    purity === 'nsfw' ||
    purity === '001' ||
    purity === '010' ||
    purity === '011' ||
    purity === '101'
  ) {
    return 'danger'
  }
  return 'neutral'
}
