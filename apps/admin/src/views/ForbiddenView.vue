<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

async function backToLogin() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="forbidden-wrap">
    <el-result icon="warning" title="无权限访问" sub-title="当前账号不是管理员，无法使用管理后台。">
      <template #extra>
        <p v-if="auth.user" class="text-muted">当前登录：{{ auth.user.email }}</p>
        <el-button type="primary" @click="backToLogin">退出并使用其他账号登录</el-button>
      </template>
    </el-result>
  </div>
</template>

<style scoped>
.forbidden-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
