<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { listShareItems } from '@/services/shareGallery'

const studios = [
  {
    to: '/text-to-image',
    icon: 'bi-stars',
    title: '文生图',
    description: '一句话生成高清图片，支持参考图与多比例输出。',
    tone: 'violet',
  },
  {
    to: '/ai-illustration-coloring',
    icon: 'bi-brush-fill',
    title: '插画染色',
    description: '上传线稿，AI 智能上色并保留全部笔触细节。',
    tone: 'rose',
  },
  {
    to: '/design-workshop',
    icon: 'bi-bezier2',
    title: 'UI 设计稿',
    description: '生成前端界面设计稿，透明 PNG 与 SVG 一键导出。',
    tone: 'cyan',
  },
  {
    to: '/model-sheet',
    icon: 'bi-person-bounding-box',
    title: '超高清模型图',
    description: '多视角模型参考图，为建模与手办制作提供素材。',
    tone: 'amber',
  },
  {
    to: '/game-art',
    icon: 'bi-controller',
    title: '游戏设计',
    description: '角色、场景、道具、图标与贴图等游戏生产素材。',
    tone: 'emerald',
  },
  {
    to: '/ai-puzzle',
    icon: 'bi-puzzle-fill',
    title: 'AI 拼图',
    description: '选择模板在线制作照片拼图，导出高清 PNG。',
    tone: 'blue',
  },
]

const galleryItems = ref([])
const galleryLoading = ref(true)

onMounted(async () => {
  try {
    const { items } = await listShareItems({ limit: 12 })
    galleryItems.value = items.filter((item) => item.coverUrl || item.mediaUrls?.length)
  } catch {
    galleryItems.value = []
  } finally {
    galleryLoading.value = false
  }
})

function itemCover(item) {
  return item.coverUrl || item.mediaUrls?.[0] || ''
}
</script>

<template>
  <div class="home-page">
    <!-- 星空氛围背景 -->
    <div class="home-sky" aria-hidden="true">
      <span v-for="n in 40" :key="n" class="home-star" :style="{
        left: `${(n * 61) % 100}%`,
        top: `${(n * 37) % 100}%`,
        animationDelay: `${(n % 9) * 0.7}s`,
        animationDuration: `${3 + (n % 5)}s`,
      }"></span>
    </div>

    <!-- Hero -->
    <section class="home-hero">
      <p class="home-hero-eyebrow">StarCloudIsAI · 星空云绘</p>
      <h1 class="home-hero-title">在云端星空里，<br />把想象绘成图像</h1>
      <p class="home-hero-subtitle">
        文生图、插画染色、UI 设计稿、模型图、游戏素材与拼图 —— 一站式 AI 创作工作台。
      </p>
      <div class="home-hero-actions">
        <RouterLink class="home-btn is-primary" to="/text-to-image">
          <i class="bi bi-stars"></i> 开始创作
        </RouterLink>
        <RouterLink class="home-btn is-ghost" to="/share">
          <i class="bi bi-images"></i> 逛逛画廊
        </RouterLink>
      </div>
    </section>

    <!-- AI 创作入口 -->
    <section class="home-section">
      <header class="home-section-head">
        <h2>AI 创作入口</h2>
        <p>六大工作台，覆盖从灵感草图到生产素材的完整链路。</p>
      </header>
      <div class="home-studio-grid">
        <RouterLink
          v-for="studio in studios"
          :key="studio.to"
          :to="studio.to"
          class="home-studio-card"
          :data-tone="studio.tone"
        >
          <span class="home-studio-icon"><i class="bi" :class="studio.icon"></i></span>
          <h3>{{ studio.title }}</h3>
          <p>{{ studio.description }}</p>
          <span class="home-studio-cta">进入工作台 <i class="bi bi-arrow-right"></i></span>
        </RouterLink>
      </div>
    </section>

    <!-- 画廊精选 -->
    <section class="home-section">
      <header class="home-section-head">
        <h2>画廊精选</h2>
        <p>社区创作者提交并通过审核的近期作品。</p>
        <RouterLink class="home-section-more" to="/share">查看全部 <i class="bi bi-arrow-right"></i></RouterLink>
      </header>

      <div v-if="galleryLoading" class="home-gallery-grid">
        <div v-for="n in 8" :key="n" class="home-gallery-skeleton"></div>
      </div>
      <div v-else-if="galleryItems.length" class="home-gallery-grid">
        <RouterLink
          v-for="item in galleryItems"
          :key="item.id"
          to="/share"
          class="home-gallery-card"
        >
          <img :src="itemCover(item)" :alt="item.title || 'AI 作品'" loading="lazy" />
          <span class="home-gallery-meta">
            <strong>{{ item.title || 'AI 作品' }}</strong>
            <small v-if="item.author?.username">@{{ item.author.username }}</small>
          </span>
        </RouterLink>
      </div>
      <div v-else class="home-gallery-empty">
        <i class="bi bi-image"></i>
        <p>画廊暂时还没有作品，快去创作第一幅吧。</p>
        <RouterLink class="home-btn is-primary" to="/text-to-image">立即创作</RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-page {
  position: relative;
  min-height: 100vh;
  padding: 0 clamp(16px, 4vw, 48px) 80px;
  color: var(--text-color, #f0f0f0);
  overflow: hidden;
}

.home-sky {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(1200px 500px at 70% -10%, rgba(99, 102, 241, 0.16), transparent 60%),
    radial-gradient(900px 420px at 15% 10%, rgba(56, 189, 248, 0.1), transparent 65%);
}

.home-star {
  position: absolute;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.7);
  animation: home-star-twinkle 4s ease-in-out infinite;
}

@keyframes home-star-twinkle {
  0%, 100% { opacity: 0.15; transform: scale(0.8); }
  50% { opacity: 0.9; transform: scale(1.25); }
}

.home-hero {
  position: relative;
  max-width: 860px;
  margin: 0 auto;
  padding: clamp(64px, 12vh, 140px) 0 clamp(40px, 7vh, 80px);
  text-align: center;
}

.home-hero-eyebrow {
  margin-bottom: 14px;
  font-size: 13px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: rgba(165, 180, 252, 0.85);
}

.home-hero-title {
  margin: 0 0 18px;
  font-size: clamp(34px, 6vw, 60px);
  font-weight: 700;
  line-height: 1.16;
  background: linear-gradient(120deg, #e0e7ff 20%, #a5b4fc 55%, #67e8f9 90%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.home-hero-subtitle {
  margin: 0 auto 30px;
  max-width: 560px;
  font-size: clamp(14px, 1.8vw, 17px);
  line-height: 1.7;
  color: rgba(226, 232, 240, 0.72);
}

.home-hero-actions {
  display: flex;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
}

.home-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 26px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.home-btn.is-primary {
  color: #0b1020;
  background: linear-gradient(120deg, #a5b4fc, #67e8f9);
  box-shadow: 0 10px 30px rgba(103, 232, 249, 0.22);
}

.home-btn.is-primary:hover { transform: translateY(-2px); box-shadow: 0 14px 36px rgba(103, 232, 249, 0.3); }

.home-btn.is-ghost {
  color: rgba(226, 232, 240, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.32);
  background: rgba(15, 23, 42, 0.4);
}

.home-btn.is-ghost:hover { transform: translateY(-2px); background: rgba(30, 41, 59, 0.55); }

.home-section {
  position: relative;
  max-width: 1180px;
  margin: 0 auto;
  padding-top: clamp(44px, 7vh, 72px);
}

.home-section-head {
  position: relative;
  margin-bottom: 26px;
}

.home-section-head h2 {
  margin: 0 0 6px;
  font-size: clamp(22px, 3vw, 30px);
  font-weight: 700;
}

.home-section-head p {
  margin: 0;
  color: rgba(226, 232, 240, 0.6);
  font-size: 14px;
}

.home-section-more {
  position: absolute;
  right: 0;
  top: 8px;
  color: rgba(165, 180, 252, 0.9);
  font-size: 14px;
  text-decoration: none;
}

.home-section-more:hover { color: #c7d2fe; }

.home-studio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 18px;
}

.home-studio-card {
  --tone: 129, 140, 248;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 24px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(160deg, rgba(var(--tone), 0.09), rgba(15, 23, 42, 0.55) 55%);
  text-decoration: none;
  color: inherit;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.home-studio-card[data-tone='rose'] { --tone: 244, 114, 182; }
.home-studio-card[data-tone='cyan'] { --tone: 34, 211, 238; }
.home-studio-card[data-tone='amber'] { --tone: 251, 191, 36; }
.home-studio-card[data-tone='emerald'] { --tone: 52, 211, 153; }
.home-studio-card[data-tone='blue'] { --tone: 96, 165, 250; }

.home-studio-card:hover {
  transform: translateY(-4px);
  border-color: rgba(var(--tone), 0.45);
  box-shadow: 0 18px 44px rgba(var(--tone), 0.14);
}

.home-studio-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  font-size: 20px;
  color: rgb(var(--tone));
  background: rgba(var(--tone), 0.14);
}

.home-studio-card h3 { margin: 4px 0 0; font-size: 18px; }

.home-studio-card p {
  margin: 0;
  flex: 1;
  font-size: 13.5px;
  line-height: 1.6;
  color: rgba(226, 232, 240, 0.62);
}

.home-studio-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--tone));
}

.home-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.home-gallery-card {
  position: relative;
  display: block;
  border-radius: 14px;
  overflow: hidden;
  aspect-ratio: 4 / 3;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.5);
}

.home-gallery-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.28s ease;
}

.home-gallery-card:hover img { transform: scale(1.05); }

.home-gallery-meta {
  position: absolute;
  inset: auto 0 0;
  padding: 26px 12px 10px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(transparent, rgba(2, 6, 23, 0.86));
}

.home-gallery-meta strong {
  font-size: 13.5px;
  color: #f1f5f9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-gallery-meta small { font-size: 11.5px; color: rgba(203, 213, 225, 0.72); }

.home-gallery-skeleton {
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  background: linear-gradient(110deg, rgba(30, 41, 59, 0.6) 30%, rgba(51, 65, 85, 0.6) 50%, rgba(30, 41, 59, 0.6) 70%);
  background-size: 200% 100%;
  animation: home-skeleton-wave 1.4s ease infinite;
}

@keyframes home-skeleton-wave {
  to { background-position: -200% 0; }
}

.home-gallery-empty {
  display: grid;
  place-items: center;
  gap: 12px;
  padding: 60px 20px;
  border-radius: 18px;
  border: 1px dashed rgba(148, 163, 184, 0.3);
  color: rgba(226, 232, 240, 0.6);
  text-align: center;
}

.home-gallery-empty i { font-size: 34px; }
.home-gallery-empty p { margin: 0; }
</style>
