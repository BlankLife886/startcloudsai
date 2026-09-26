/** Export only operational evidence. Redact secrets and pseudonymize common identifiers. */
export function sanitizeDiagnostics(value: unknown): unknown {
  const ids = new Map<string, string>()
  const pseudonym = (raw: string) => { if (!ids.has(raw)) ids.set(raw, `subject-${ids.size + 1}`); return ids.get(raw)! }
  const walk = (input: unknown, key = ''): unknown => {
    if (typeof input === 'string' && /^(userId|userEmail|username|adminId|adminEmail|apiKeyId|email|clientIp|ip)$/i.test(key)) return input ? pseudonym(input) : input
    if (!/^(promptVersion|promptTokens)$/i.test(key) && /password|secret|authorization|cookie|api.?key|access.?token|refresh.?token|prompt|messagebody|requestbody|responsebody|content/i.test(key)) return '[redacted]'
    if (typeof input === 'string') {
      return input.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
        .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[redacted-key]')
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, pseudonym)
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, pseudonym)
        .replace(/([?&](?:token|key|api_key|signature|secret)=)[^&\s]+/gi, '$1[redacted]')
        .slice(0, 4000)
    }
    if (Array.isArray(input)) return input.map(item => walk(item))
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, walk(v, k)]))
    return input
  }
  return walk(value)
}

export function downloadDiagnosticJSON(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(sanitizeDiagnostics(value), null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
