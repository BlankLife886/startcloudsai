/** Natural calendar dates in UTC+8, matching the admin API's inclusive date picker. */
export function adminRecentRange(days = 30, now = Date.now()) {
  const end = new Date(now + 8 * 3600_000)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - Math.max(1, days) + 1)
  return { createdFrom: start.toISOString().slice(0, 10), createdTo: end.toISOString().slice(0, 10) }
}
