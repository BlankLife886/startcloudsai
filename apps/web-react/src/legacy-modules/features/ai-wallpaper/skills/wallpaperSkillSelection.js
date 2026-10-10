export function normalizeSelectedWallpaperSkillIds(value, availableSkills = []) {
  if (!Array.isArray(value)) return []
  const allowed = new Set(
    (Array.isArray(availableSkills) ? availableSkills : [])
      .map((skill) => String(skill?.id || skill || '').trim())
      .filter(Boolean),
  )
  const seen = new Set()
  return value
    .map((id) => String(id || '').trim())
    .filter((id) => {
      if (!id || id === 'none' || !allowed.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
}
