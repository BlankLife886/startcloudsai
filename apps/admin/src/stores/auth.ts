import { defineStore } from 'pinia'
import { ApiError, request } from '@/request'

export interface AdminAccount {
  id: string
  email: string
  username: string | null
  avatarUrl: string | null
  role: string
  createdAt: string
}

function isMalformedSuccess(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.code === 'response_malformed' || (error.status >= 200 && error.status < 300))
  )
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as AdminAccount | null,
    /** 是否已向服务端确认过登录态 */
    loaded: false,
  }),
  getters: {
    isAdmin: (state) => state.user?.role === 'admin',
  },
  actions: {
    async fetchMe() {
      try {
        const data = await request<{ admin: AdminAccount | null }>('/api/v1/admin/auth/session', {
          silent: true,
          scope: 'persistent',
        })
        this.user = data.admin
      } catch {
        this.user = null
      } finally {
        this.loaded = true
      }
    },
    async login(email: string, password: string, options: { silent?: boolean } = {}) {
      try {
        const data = await request<{ admin: AdminAccount }>('/api/v1/admin/auth/session', {
          method: 'POST',
          body: { email, password },
          silent: options.silent,
        })
        this.user = data.admin
        this.loaded = true
        return data.admin
      } catch (error) {
        // Cookie 可能已下发但 JSON body 被截断；回查会话避免误报登录失败。
        if (!isMalformedSuccess(error)) throw error
        await this.fetchMe()
        if (!this.user) throw error
        return this.user
      }
    },
    async logout() {
      try {
        await request('/api/v1/admin/auth/session', { method: 'DELETE', silent: true })
      } catch {
        // 忽略退出失败，本地状态照常清空
      }
      this.user = null
    },
  },
})
