<script setup>
import { buildProfileHubStats, buildProfileServiceLinks } from '@/features/profile/profileHub'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  loading: { type: Boolean, default: false },
  resourceSummary: { type: Object, default: () => ({}) },
  planCurrent: { type: Object, default: null },
  syncEnabled: { type: Boolean, default: false },
  downloadCount: { type: Number, default: 0 },
  downloadsEnabled: { type: Boolean, default: true },
})

const router = useRouter()

const stats = computed(() => buildProfileHubStats(props.resourceSummary, props.planCurrent))
const serviceLinks = computed(() =>
  buildProfileServiceLinks({
    downloadCount: props.downloadCount,
    downloadsEnabled: props.downloadsEnabled,
  }),
)

function openPricingSection(section) {
  router.push({ name: 'pricing', query: section ? { section } : {} })
}

function openLink(link) {
  if (!link?.to) return
  router.push(link.to)
}

function statAction(stat) {
  if (stat.id === 'balance' || stat.id === 'keys')
    openPricingSection(stat.id === 'keys' ? 'keys' : 'wallet')
  else if (stat.id === 'plan') openPricingSection('plans')
  else if (stat.id === 'usage') openPricingSection('usage')
}
</script>

<template>
  <section class="profile-hub profile-hub--slim" aria-label="账户速览">
    <header class="profile-hub-head">
      <div>
        <span class="profile-hub-kicker">Account</span>
        <h3 class="profile-hub-title">账户速览</h3>
      </div>
      <span class="profile-hub-pill" :class="{ 'is-on': syncEnabled }">
        <i class="bi" :class="syncEnabled ? 'bi-cloud-check' : 'bi-cloud-slash'"></i>
        {{ syncEnabled ? '云同步' : '本地' }}
      </span>
    </header>

    <div class="profile-hub-stats" :class="{ 'is-loading': loading }">
      <button
        v-for="(stat, index) in stats"
        :key="stat.id"
        type="button"
        class="profile-hub-stat"
        :data-tone="stat.tone"
        :style="{ '--hub-delay': `${index * 0.04}s` }"
        @click="statAction(stat)"
      >
        <span class="profile-hub-stat-label">{{ stat.label }}</span>
        <strong class="profile-hub-stat-value">{{ loading ? '—' : stat.value }}</strong>
        <small>{{ stat.hint }}</small>
      </button>
    </div>

    <div class="profile-hub-links">
      <button
        v-for="link in serviceLinks"
        :key="link.id"
        type="button"
        class="profile-hub-link"
        @click="openLink(link)"
      >
        <i class="bi" :class="link.icon"></i>
        {{ link.label }}
      </button>
    </div>
  </section>
</template>
