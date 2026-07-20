<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

// 返回首页
function goHome() {
  router.push('/')
}

// 返回上一页
function goBack() {
  router.back()
}
</script>

<template>
  <div class="not-found-container">
    <div class="container text-center">
      <div class="error-code">404</div>
      <h1 class="mb-4">页面未找到</h1>
      <p class="mb-5">抱歉，您访问的页面不存在或已被移除。</p>
      <div class="d-flex justify-content-center gap-3">
        <button class="btn theme-button" @click="goHome">
          <i class="bi bi-house-door"></i> 返回首页
        </button>
        <button class="btn btn-outline-secondary" @click="goBack">
          <i class="bi bi-arrow-left"></i> 返回上一页
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.not-found-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  padding: 2rem 0;
}

.error-code {
  font-size: 8rem;
  font-weight: bold;
  color: var(--primary-color);
  line-height: 1;
  margin-bottom: 1rem;
  font-family: 'Share Tech Mono', monospace;
  text-shadow: 0 0 10px rgba(76, 175, 80, 0.5);
}

h1 {
  font-size: 2.5rem;
  color: var(--text-color);
}

p {
  font-size: 1.2rem;
  color: var(--text-color);
  opacity: 0.8;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}
</style>
