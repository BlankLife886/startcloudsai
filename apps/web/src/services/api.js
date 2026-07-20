/**
 * 旧 Wallhaven / 中转站 API 的兼容占位。
 * Wallhaven 浏览与网关能力已随后端重构下线；保留极小接口形状，
 * 让个别仍引用这些符号的工作台代码可以优雅降级（返回空结果）。
 */

export function proxyWallhavenImageUrl(url) {
  return String(url || '')
}

export function buildApiUrl(path) {
  const normalized = String(path || '').startsWith('/') ? path : `/${path}`
  return `/api${normalized}`
}

export const wallpaperApi = {
  async search() {
    return { data: [], meta: { total: 0 } }
  },
  async getWallpaperDetails() {
    throw new Error('壁纸浏览功能已下线')
  },
}

export const aiCapabilityApi = {
  async getCapabilities() {
    return { success: false, storage: 'browser-local' }
  },
  async updateCapabilities() {
    return { success: false }
  },
  async testMcp() {
    return { success: false, message: '当前部署未启用 MCP 测试' }
  },
}
