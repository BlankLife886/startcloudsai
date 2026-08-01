import { defineStore } from 'pinia'
import { request } from '@/request'

export interface AdminAccount {
  id: string
  email: string
  username: string | null
  avatarUrl: string | null
  role: string
  createdAt: string
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
        const data = await request<{ admin: AdminAccount | null }>('/api/v1/admin/auth/session', { silent: true })
        this.user = data.admin
      } catch {
        this.user = null
      } finally {
        this.loaded = true
      }
    },
    async login(email: string, password: string, options: { silent?: boolean } = {}) {
      const data = await request<{ admin: AdminAccount }>('/api/v1/admin/auth/session', {
        method: 'POST',
        body: { email, password },
        silent: options.silent,
      })
      this.user = data.admin
      this.loaded = true
      return data.admin
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
