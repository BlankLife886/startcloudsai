<script setup>
import { RouterLink } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import trophyArt from '@/assets/incentives/rewards-trophy.png'

const appearanceStore = useAppearanceStore()

const benefits = [
  {
    id: 'group',
    name: '好友拼团',
    category: '拼团裂变',
    icon: 'bi-people-fill',
    tone: 'coral',
    description: '发起或加入限时拼团，满员后奖励自动发放到每位成员账户。',
    action: '进入拼团',
  },
  {
    id: 'membership',
    name: '会员计划',
    category: '长期价值',
    icon: 'bi-gem',
    tone: 'violet',
    description: '集中查看会员周期、积分供给与专属权益方案。',
    action: '查看计划',
  },
  {
    id: 'failure',
    name: '失败补偿',
    category: '服务保障',
    icon: 'bi-shield-check',
    tone: 'teal',
    description: '符合规则的失败任务自动退款，并按活动配置发放额外补偿。',
    action: '查看保障',
  },
  {
    id: 'usage',
    name: '用量计划',
    category: '用量激励',
    icon: 'bi-bar-chart-fill',
    tone: 'amber',
    description: '按本月成功交付量解锁档位奖励，达标后积分自动到账。',
    action: '查看计划',
  },
  {
    id: 'suggestion',
    name: '建议采纳',
    category: '产品共创',
    icon: 'bi-lightbulb-fill',
    tone: 'green',
    description: '提交产品建议，评审采纳后按价值等级发放创作积分。',
    action: '参与共创',
  },
]

const assurances = [
  { icon: 'bi-coin', title: '多种奖励形式', copy: '积分、权益与活动奖励' },
  { icon: 'bi-shield-check', title: '公平透明', copy: '规则清晰，记录可查' },
  { icon: 'bi-lightning-charge-fill', title: '快速到账', copy: '满足条件后自动发放' },
  { icon: 'bi-headset', title: '专属支持', copy: '问题反馈快速响应' },
]
</script>

<template>
  <main class="rewards-page" :class="{ 'is-dark': appearanceStore.isDark }">
    <section class="rewards-hero">
      <div class="rewards-hero__copy">
        <p>CREATOR REWARDS</p>
        <h1>创作激励</h1>
        <span>选择一个激励计划，进入页面查看权益、进度与参与方式。</span>
        <div class="rewards-hero__actions">
          <a href="#reward-plans">查看激励计划</a>
          <a href="#reward-benefits" class="is-secondary"
            ><i class="bi bi-play-fill"></i>了解更多</a
          >
        </div>
      </div>

      <div class="rewards-hero__asset" aria-hidden="true">
        <img :src="trophyArt" alt="" loading="lazy" />
      </div>
    </section>

    <section id="reward-plans" class="benefit-grid" aria-label="创作激励计划">
      <RouterLink
        v-for="(benefit, index) in benefits"
        :key="benefit.id"
        :to="`/incentive-plans/${benefit.id}`"
        class="benefit-card"
        :data-tone="benefit.tone"
      >
        <span class="benefit-card__number">0{{ index + 1 }}</span>
        <span class="benefit-card__icon" aria-hidden="true"
          ><i class="bi" :class="benefit.icon"></i
        ></span>
        <div class="benefit-card__copy">
          <small>{{ benefit.category }}</small>
          <h2>{{ benefit.name }}</h2>
          <p>{{ benefit.description }}</p>
        </div>
        <i class="benefit-card__watermark bi" :class="benefit.icon" aria-hidden="true"></i>
        <strong>{{ benefit.action }}<i class="bi bi-arrow-right"></i></strong>
      </RouterLink>
    </section>

    <section id="reward-benefits" class="reward-assurances" aria-label="创作激励保障">
      <div v-for="item in assurances" :key="item.title">
        <span><i class="bi" :class="item.icon"></i></span>
        <p>
          <strong>{{ item.title }}</strong
          ><small>{{ item.copy }}</small>
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.rewards-page {
  --ink: #101827;
  --muted: #68758a;
  --orange: #f36b21;
  --line: #e9edf2;
  --line-soft: #edf0f3;
  --bg: #ffffff;
  --surface: #ffffff;
  --surface-soft: #fffaf3;
  --surface-warm: #fff4e9;
  --hero-a: rgb(255 209 145 / 40%);
  --hero-b: rgb(255 224 186 / 44%);
  --hero-c: #fffbf5;
  --hero-d: #fff4e6;
  --hero-e: #ffe8cd;
  --hero-line: #f4e8d8;
  --body: #56647a;
  --card-shadow: 0 8px 20px rgb(28 48 78 / 7%);
  --card-shadow-hover: 0 13px 28px rgb(28 48 78 / 11%);
  --assurance-line: #e8ecf1;
  --assure-blue-bg: #eaf6fd;
  --assure-green-bg: #eaf8f1;
  --assure-violet-bg: #f1edfc;
  width: 100%;
  min-width: 1180px;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 12px 0 20px;
  color: var(--ink);
  background: var(--bg);
}

.rewards-page.is-dark {
  --ink: #f4eee6;
  --muted: #a79c8f;
  --orange: #ff8a3d;
  --line: #3b342c;
  --line-soft: #2f2922;
  --bg: #12100e;
  --surface: #1c1915;
  --surface-soft: #181511;
  --surface-warm: #221c16;
  --hero-a: rgb(255 138 61 / 18%);
  --hero-b: rgb(255 176 96 / 12%);
  --hero-c: #1a1511;
  --hero-d: #241c15;
  --hero-e: #17130f;
  --hero-line: #332c24;
  --body: #cfc4b6;
  --card-shadow: 0 8px 20px rgb(0 0 0 / 28%);
  --card-shadow-hover: 0 13px 28px rgb(0 0 0 / 32%);
  --assurance-line: #3b342c;
  --assure-blue-bg: color-mix(in srgb, #2e9fdf 16%, #1c1915);
  --assure-green-bg: color-mix(in srgb, #39b978 16%, #1c1915);
  --assure-violet-bg: color-mix(in srgb, #8d62e5 16%, #1c1915);
}

.rewards-hero {
  display: grid;
  width: calc(100% - 120px);
  min-height: 270px;
  grid-template-columns: minmax(560px, 1fr) minmax(620px, 1fr);
  align-items: center;
  margin: 0 auto;
  overflow: hidden;
  background:
    radial-gradient(circle at 86% 8%, var(--hero-a), transparent 40%),
    radial-gradient(circle at 58% 96%, var(--hero-b), transparent 44%),
    linear-gradient(102deg, var(--hero-c) 0%, var(--hero-d) 55%, var(--hero-e) 100%);
  border: 1px solid var(--hero-line);
  border-radius: 12px;
}
.rewards-hero__copy {
  padding: 34px 40px 30px 112px;
}
.rewards-hero__copy > p {
  margin: 0 0 10px;
  color: var(--orange);
  font-size: 11px;
  font-weight: 850;
}
.rewards-hero h1 {
  margin: 0;
  font-size: 43px;
  font-weight: 850;
  line-height: 1.08;
  letter-spacing: 0;
}
.rewards-hero__copy > span {
  display: block;
  margin-top: 17px;
  color: var(--body);
  font-size: 14px;
}
.rewards-hero__actions {
  display: flex;
  gap: 16px;
  margin-top: 27px;
}
.rewards-hero__actions a {
  display: inline-flex;
  min-width: 132px;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 18px;
  color: #fff;
  background: var(--orange);
  border: 1px solid var(--orange);
  border-radius: 7px;
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
}
.rewards-hero__actions a.is-secondary {
  color: var(--orange);
  background: var(--surface);
}
.rewards-hero__asset {
  display: grid;
  width: 100%;
  height: 270px;
  align-items: center;
  justify-items: center;
}
.rewards-hero__asset img {
  width: min(92%, 480px);
  mix-blend-mode: multiply;
}
.rewards-page.is-dark .rewards-hero__asset img {
  mix-blend-mode: normal;
}

.benefit-grid {
  display: grid;
  width: calc(100% - 180px);
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 22px 24px;
  margin: 24px auto 0;
  scroll-margin-top: 90px;
}
.benefit-card {
  --accent: #ff4f86;
  --soft: #fff0f5;
  position: relative;
  display: grid;
  min-height: 212px;
  grid-column: span 2;
  grid-template-columns: 80px minmax(0, 1fr);
  grid-template-rows: 1fr auto;
  column-gap: 20px;
  padding: 24px 28px 18px;
  overflow: hidden;
  color: var(--ink);
  text-decoration: none;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--card-shadow);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}
.benefit-card:nth-child(n + 4) {
  grid-column: span 3;
}
.benefit-card:hover {
  color: var(--ink);
  border-color: color-mix(in srgb, var(--accent) 36%, var(--line));
  box-shadow: var(--card-shadow-hover);
  transform: translateY(-2px);
}
.benefit-card[data-tone='violet'] {
  --accent: #825dff;
  --soft: #f2efff;
}
.benefit-card[data-tone='teal'] {
  --accent: #0ebdb7;
  --soft: #e9fbfa;
}
.benefit-card[data-tone='amber'] {
  --accent: #f28a13;
  --soft: #fff5e8;
}
.benefit-card[data-tone='green'] {
  --accent: #29b968;
  --soft: #eaf9ef;
}
.rewards-page.is-dark .benefit-card {
  --soft: color-mix(in srgb, #ff4f86 14%, #1c1915);
}
.rewards-page.is-dark .benefit-card[data-tone='violet'] {
  --soft: color-mix(in srgb, #825dff 14%, #1c1915);
}
.rewards-page.is-dark .benefit-card[data-tone='teal'] {
  --soft: color-mix(in srgb, #0ebdb7 14%, #1c1915);
}
.rewards-page.is-dark .benefit-card[data-tone='amber'] {
  --soft: color-mix(in srgb, #f28a13 14%, #1c1915);
}
.rewards-page.is-dark .benefit-card[data-tone='green'] {
  --soft: color-mix(in srgb, #29b968 14%, #1c1915);
}
.benefit-card__number {
  position: absolute;
  top: 18px;
  right: 22px;
  color: color-mix(in srgb, var(--accent) 25%, transparent);
  font-size: 18px;
  font-weight: 900;
}
.benefit-card__icon {
  display: grid;
  width: 72px;
  height: 72px;
  grid-row: 1;
  place-items: center;
  color: var(--accent);
  background: var(--soft);
  border-radius: 11px;
  font-size: 30px;
}
.benefit-card__copy {
  position: relative;
  z-index: 2;
  min-width: 0;
  padding-top: 9px;
}
.benefit-card small {
  color: var(--accent);
  font-size: 11px;
  font-weight: 850;
}
.benefit-card h2 {
  margin: 6px 0 8px;
  font-size: 23px;
  letter-spacing: 0;
}
.benefit-card p {
  max-width: 470px;
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
.benefit-card__watermark {
  position: absolute;
  right: 28px;
  bottom: 26px;
  color: color-mix(in srgb, var(--accent) 7%, transparent);
  font-size: 94px;
}
.benefit-card > strong {
  position: relative;
  z-index: 2;
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  padding-top: 15px;
  color: var(--accent);
  border-top: 1px solid var(--line-soft);
  font-size: 12px;
}
.benefit-card > strong i {
  font-size: 17px;
}

.reward-assurances {
  display: grid;
  width: calc(100% - 180px);
  min-height: 82px;
  grid-template-columns: repeat(4, 1fr);
  margin: 24px auto 0;
  background: var(--surface);
  border: 1px solid var(--assurance-line);
  border-radius: 8px;
  box-shadow: var(--card-shadow);
}
.reward-assurances > div {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border-right: 1px solid var(--assurance-line);
}
.reward-assurances > div:last-child {
  border-right: 0;
}
.reward-assurances > div > span {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  color: var(--orange);
  background: var(--surface-warm);
  border-radius: 50%;
  font-size: 22px;
}
.reward-assurances > div:nth-child(2) > span {
  color: #2e9fdf;
  background: var(--assure-blue-bg);
}
.reward-assurances > div:nth-child(3) > span {
  color: #39b978;
  background: var(--assure-green-bg);
}
.reward-assurances > div:nth-child(4) > span {
  color: #8d62e5;
  background: var(--assure-violet-bg);
}
.reward-assurances p {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
}
.reward-assurances strong {
  font-size: 13px;
}
.reward-assurances small {
  color: var(--muted);
  font-size: 11px;
}
</style>
