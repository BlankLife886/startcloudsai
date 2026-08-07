<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>

<template>
  <div class="ps-shell">
    <header class="ps-hero">
      <div class="ps-hero__copy">
        <h1>{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="ps-hero__actions">
        <slot name="actions" />
      </div>
    </header>
    <section class="ps-board">
      <slot />
    </section>
  </div>
</template>

<style scoped>
.ps-shell {
  position: relative;
  z-index: 1;
  width: min(1240px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 22px;
}

.ps-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 8px 4px 0;
}

.ps-hero h1 {
  margin: 0;
  font-size: clamp(1.7rem, 2.6vw, 2.15rem);
  font-weight: 800;
  letter-spacing: -0.03em;
}

.ps-hero__copy > p {
  margin: 8px 0 0;
  color: var(--ps-muted, rgba(28, 26, 39, 0.58));
  font-size: 0.92rem;
}

.ps-hero__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ps-board {
  border: 1px solid var(--ps-line, rgba(28, 26, 39, 0.1));
  border-radius: 28px;
  background: var(--ps-surface, rgba(255, 255, 255, 0.82));
  backdrop-filter: blur(16px);
  padding: 18px;
  box-shadow: var(--ps-shadow, 0 18px 40px rgba(40, 30, 80, 0.07));
}

@media (max-width: 720px) {
  .ps-board {
    padding: 14px;
    border-radius: 22px;
  }
}
</style>
