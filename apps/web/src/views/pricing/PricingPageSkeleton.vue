<script setup>
import '@/features/pricing/styles/pricing-page-skeleton.css'
</script>

<template>
  <div class="pc-shell pc-shell--loading" aria-hidden="true">
    <aside class="pc-sidebar pc-skeleton-sidebar">
      <div class="pc-sidebar__surface">
      <div class="pc-sidenav__head">
        <div class="pc-skeleton-block pc-skeleton-block--user" />
        <div class="pc-skeleton-block pc-skeleton-block--wallet" />
      </div>
      <nav class="pc-sidenav__nav pc-skeleton-nav" aria-hidden="true">
        <span class="pc-skeleton-line pc-skeleton-line--group" />
        <span v-for="index in 4" :key="`primary-${index}`" class="pc-skeleton-line pc-skeleton-line--nav" />
        <span class="pc-skeleton-line pc-skeleton-line--group" />
        <span v-for="index in 3" :key="`secondary-${index}`" class="pc-skeleton-line pc-skeleton-line--nav" />
      </nav>
      <div class="pc-sidenav__foot pc-skeleton-foot">
        <span class="pc-skeleton-line pc-skeleton-line--foot" />
      </div>
      </div>
    </aside>

    <section class="pc-main">
      <div class="pc-main__surface">
      <nav class="pc-mobile-nav pc-skeleton-mobile-nav" aria-hidden="true">
        <span v-for="index in 5" :key="`pill-${index}`" class="pc-skeleton-pill" />
      </nav>

      <header class="pc-skeleton-head">
        <span class="pc-skeleton-line pc-skeleton-line--title" />
        <span class="pc-skeleton-line pc-skeleton-line--subtitle" />
      </header>

      <div class="pc-skeleton-grid pc-skeleton-grid--stats">
        <span v-for="index in 5" :key="`stat-${index}`" class="pc-skeleton-card" />
      </div>

      <div class="pc-skeleton-dashboard">
        <span class="pc-skeleton-panel pc-skeleton-panel--ring" />
        <span class="pc-skeleton-panel pc-skeleton-panel--chart" />
      </div>
      </div>
    </section>
  </div>
</template>
