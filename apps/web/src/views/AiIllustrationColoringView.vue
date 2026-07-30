<script setup>
import AiIllustrationColoringStudio from '@/features/ai-illustration-coloring/AiIllustrationColoringStudio.vue'
import { useAppearanceStore } from '@/stores/appearance'

const appearanceStore = useAppearanceStore()
</script>

<template>
  <main class="coloring-studio-page" :class="{ 'is-light': !appearanceStore.isDark }">
    <AiIllustrationColoringStudio />
  </main>
</template>
