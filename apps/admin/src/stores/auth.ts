import { defineStore } from 'pinia'
import { request } from '@/request'

export interface User {
  id: string
  email: string
  username: string | null
  avatarUrl: string | null
  role: string
  createdAt: string
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    /** 是否已向服务端确认过登录态 */
    loaded: false,
  }),
  getters: {
    isAdmin: (state) => state.user?.role === 'admin',
  },
  actions: {
    async fetchMe() {
      try {
        const data = await request<{ user: User | null }>('/api/auth/me', { silent: true })
        this.user = data.user
      } catch {
        this.user = null
      } finally {
        this.loaded = true
      }
    },
    async login(email: string, password: string) {
      const data = await request<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      this.user = data.user
      this.loaded = true
      return data.user
    },
    async logout() {
      try {
        await request('/api/auth/logout', { method: 'POST', silent: true })
      } catch {
        // 忽略退出失败，本地状态照常清空
      }
      this.user = null
    },
  },
})
