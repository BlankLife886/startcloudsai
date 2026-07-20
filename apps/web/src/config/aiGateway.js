function readEnv(key, fallback = '') {
  const value = import.meta.env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

const DEFAULT_GATEWAY = 'https://api.gptsapi.net'

export const AI_GATEWAY_BASE_URL = readEnv('VITE_AI_GATEWAY_BASE_URL', DEFAULT_GATEWAY)

export const AI_PROVIDER_CONFIG = {
  openai: {
    baseURL: readEnv('VITE_OPENAI_BASE_URL', AI_GATEWAY_BASE_URL),
  },
  anthropic: {
    baseURL: readEnv('VITE_ANTHROPIC_BASE_URL', AI_GATEWAY_BASE_URL),
  },
  gemini: {
    baseURL: readEnv('VITE_GEMINI_BASE_URL', AI_GATEWAY_BASE_URL),
  },
}

export function getAiProviderConfig(provider) {
  return AI_PROVIDER_CONFIG[provider] || null
}
