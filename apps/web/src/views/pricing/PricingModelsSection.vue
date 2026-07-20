<script lang="ts">
import { usePricingPageContext } from './pricingPageContext'
import ApiDocsView from '@/views/ApiDocsView.vue'
import PcDateTimeField from '@/components/pricing/PcDateTimeField.vue'
import PcAnimatedNumber from '@/components/pricing/PcAnimatedNumber.vue'
import PcStatAnimatedValue from '@/components/pricing/PcStatAnimatedValue.vue'
import PcSubscriptionDashboardPanel from '@/components/pricing/PcSubscriptionDashboardPanel.vue'

export default {
  components: {
    ApiDocsView,
    PcDateTimeField,
    PcAnimatedNumber,
    PcStatAnimatedValue,
    PcSubscriptionDashboardPanel,
  },
  setup: usePricingPageContext,
}
</script>

<template>
<section class="pc-section pc-models-section">
  <div class="pc-modelboard">
    <div class="pc-modelboard__toolbar">
      <label class="pc-modelboard__search">
        <i class="bi bi-search"></i>
        <input v-model="modelSearch" type="search" placeholder="搜索模型…" />
      </label>
      <button
        v-if="hasActiveModelFilters"
        type="button"
        class="pc-modelboard__clear"
        @click="clearModelFilters"
      >
        清除
      </button>
    </div>

    <div v-if="!filteredPricedModels.length" class="pc-modelboard__empty">
      <strong>{{ pricedModels.length ? '没有匹配的模型' : '暂无公开模型' }}</strong>
      <button type="button" class="pc-btn pc-btn--ghost" @click="refreshActiveSection">
        刷新目录
      </button>
    </div>

    <div v-else class="pc-modelboard__grid">
      <article
        v-for="model in filteredPricedModels"
        :key="model.id"
        class="pc-model-hero"
      >
        <img
          v-if="model.iconUrl"
          class="pc-model-hero__icon"
          :src="model.iconUrl"
          alt=""
          loading="lazy"
          decoding="async"
        />
        <div class="pc-model-hero__body">
          <div class="pc-model-hero__brand">
            <span class="pc-model-hero__name">{{ model.displayId || model.id }}</span>
          </div>
        </div>
        <div class="pc-model-hero__avail">
          <div class="pc-model-hero__avail-head">
            <span>24h 可用性</span>
            <em v-if="model.availabilityPercent != null"
              >{{ model.availabilityPercent }}%</em
            >
            <em v-else-if="model.availabilitySource === 'none'">暂无样本</em>
          </div>
          <div
            class="pc-model-hero__avail-bar"
            :title="formatAvailabilityTitle(model)"
            role="img"
            aria-label="24h 可用性"
          >
            <div
              v-for="(row, rowIndex) in model.availabilityRows"
              :key="`${model.id}-avail-row-${rowIndex}`"
              class="pc-model-hero__avail-row"
            >
              <span
                v-for="(segment, index) in row"
                :key="`${model.id}-${rowIndex}-${index}`"
                class="pc-model-hero__avail-pill"
                :class="`is-${segment}`"
              ></span>
            </div>
          </div>
        </div>
        <footer class="pc-model-hero__foot">
          <div v-if="model.cardPriceLines.length" class="pc-model-hero__price-lines">
            <div
              v-for="line in model.cardPriceLines"
              :key="`${model.id}-${line.key}`"
              class="pc-model-hero__price-row"
            >
              <span v-if="line.label" class="pc-model-hero__price-label">{{
                line.label
              }}</span>
              <span class="pc-model-hero__price-value">
                <template v-if="line.key === 'empty'">{{ line.amount }}</template>
                <template v-else>{{ line.amount }}<small>/1M</small></template>
              </span>
            </div>
          </div>
          <div v-else class="pc-model-hero__price">
            <span>{{ formatModelCardPrimaryLine(model) }}</span>
          </div>
          <div v-if="model.marketLine" class="pc-model-hero__market">
            Market:
            <s>{{ model.marketLine.market }}</s>
            / {{ model.marketLine.discount }}
          </div>
        </footer>
      </article>
    </div>
  </div>
</section>
</template>
