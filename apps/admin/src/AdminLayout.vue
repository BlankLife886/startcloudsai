<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowDown,
  Odometer,
  User,
  Tickets,
  Coin,
  Goods,
  Monitor,
  Picture,
  Document,
  List,
  Setting,
} from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const menus = [
  { path: '/', label: '仪表盘', icon: Odometer },
  { path: '/users', label: '用户管理', icon: User },
  { path: '/orders', label: '订单', icon: Tickets },
  { path: '/finance', label: '财务', icon: Coin },
  { path: '/plans', label: '套餐', icon: Goods },
  { path: '/tasks', label: '任务监控', icon: Monitor },
  { path: '/gallery', label: '画廊审核', icon: Picture },
  { path: '/content', label: '内容管理', icon: Document },
  { path: '/audit', label: '审计日志', icon: List },
  { path: '/settings', label: '系统设置', icon: Setting },
]

async function onLogout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <el-container class="layout">
    <el-aside width="200px" class="aside">
      <div class="logo">StartClouds 后台</div>
      <el-menu router :default-active="route.path" class="menu">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="header-title">{{ route.meta.title }}</span>
        <el-dropdown @command="onLogout">
          <span class="header-user">
            {{ auth.user?.username || auth.user?.email }}
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100%;
}

.aside {
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
}

.logo {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
  border-bottom: 1px solid #e4e7ed;
}

.menu {
  border-right: none;
  flex: 1;
}

.header {
  height: 56px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
}

.header-user {
  cursor: pointer;
  display: flex;
  align-items: center;
  color: #303133;
  outline: none;
}

.main {
  padding: 0;
  overflow: auto;
}
</style>
