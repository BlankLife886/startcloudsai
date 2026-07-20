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

<section
  class="pc-section pc-overview"
  :class="{ 'is-subscribed': subscriptionPeriod.isActive }"
>
  <article v-if="authStore.isAuthenticated" class="pc-overview__plans">
    <PcSubscriptionDashboardPanel
      compact
      :dashboard="subscriptionDashboard"
      :numbers-enabled="subscriptionPanelNumbersEnabled && activeSection === 'overview'"
      :key-action-loading="Boolean(keyActionLoading)"
      @reset-key="openKeyResetModal(subscriptionKey)"
      @subscribe="selectSection('plans')"
    >
      <template #title>当前套餐</template>
      <template #actions>
        <button
          v-if="subscriptionPeriod.isActive"
          type="button"
          class="pc-btn pc-btn--ghost"
          @click="goManageSubscription"
        >
          管理订阅
        </button>
      </template>
    </PcSubscriptionDashboardPanel>
  </article>

  <div class="pc-overview-stats pc-overview__metrics">
    <p
      v-if="authStore.isAuthenticated && resourcesLoading"
      class="pc-overview-loading-hint"
    >
      用量数据加载中…
    </p>
    <article
      v-for="card in overviewDashboard.stats"
      :key="card.id"
      class="pc-overview-stat"
      :class="`is-${card.tone}`"
    >
      <div class="pc-overview-stat__head">
        <span>{{ card.label }}</span>
        <i class="bi" :class="card.icon"></i>
      </div>
      <PcStatAnimatedValue :card="card" :enabled="overviewNumbersEnabled" />
      <small :class="{ 'is-accent': card.hintAccent }">{{ card.hint }}</small>
      <button
        v-if="card.actionLabel"
        type="button"
        class="pc-plan-subscribe-btn"
        @click="selectSection(card.actionSection || 'plans')"
      >
        {{ card.actionLabel }}
      </button>
    </article>
  </div>

  <article
    v-if="overviewDashboard.keyKindPanel?.hasData"
    class="pc-overview-panel pc-overview-key-split pc-overview__metrics"
  >
    <header class="pc-overview-panel__head">
      <div>
        <h2>本月 API 分账</h2>
        <p>订阅密钥与充值密钥的调用次数与美元消耗（共用钱包扣费）</p>
      </div>
      <PcAnimatedNumber
        tag="strong"
        class="pc-overview-key-split__total"
        :value="overviewDashboard.keyKindPanel.totalCost"
        format="usd"
        :delay="overviewNumberDelay(280)"
        :enabled="overviewNumbersEnabled"
      />
    </header>
    <div class="pc-overview-key-split__grid">
      <article
        v-for="(item, itemIndex) in overviewDashboard.keyKindPanel.items"
        :key="item.id"
        class="pc-overview-key-split__card"
        :class="`is-${item.tone}`"
      >
        <div class="pc-overview-key-split__card-head">
          <i class="bi" :class="item.icon"></i>
          <span>{{ item.label }}</span>
        </div>
        <PcAnimatedNumber
          tag="strong"
          :value="item.count"
          format="integer"
          :delay="overviewNumberDelay(340 + itemIndex * 70)"
          :enabled="overviewNumbersEnabled"
        />
        <small>
          次 ·
          <PcAnimatedNumber
            tag="span"
            :value="item.cost"
            format="usd"
            :delay="overviewNumberDelay(380 + itemIndex * 70)"
            :enabled="overviewNumbersEnabled"
          />
        </small>
        <div
          v-if="overviewDashboard.keyKindPanel.totalCost > 0"
          class="pc-overview-key-split__share"
        >
          <i :style="{ width: `${item.share}%` }"></i>
        </div>
      </article>
    </div>
  </article>

  <article class="pc-overview-panel pc-overview-panel--trend pc-overview__detail">
    <header class="pc-overview-panel__head">
      <div>
        <h2>用量趋势</h2>
        <p>{{ overviewRangeSubtitle(overviewTrendRange) }}</p>
      </div>
      <div class="pc-overview-range" role="tablist" aria-label="趋势时间范围">
        <button
          v-for="option in overviewRangeOptions"
          :key="`trend-${option.id}`"
          type="button"
          role="tab"
          class="pc-overview-range__btn"
          :class="{ 'is-active': overviewTrendRange === option.id }"
          @click="overviewTrendRange = option.id"
        >
          {{ option.label }}
        </button>
      </div>
    </header>
    <div class="pc-overview-chart">
      <div
        v-if="!overviewDashboard.hasTrendData"
        class="pc-overview-empty-box pc-overview-empty-box--chart"
      >
        该时间范围暂无调用记录。
      </div>
      <div v-else class="pc-overview-chart__plot">
        <div class="pc-overview-chart__ylabels" aria-hidden="true">
          <span
            v-for="(tick, index) in overviewDashboard.trendChart.yTicks"
            :key="`ylabel-${index}`"
          >
            {{ tick.value }}
          </span>
        </div>
        <div
          class="pc-overview-chart__canvas"
          @mouseleave="overviewTrendHoverIndex = -1"
        >
          <svg
            :key="overviewTrendRange"
            class="pc-overview-chart__svg"
            :viewBox="`0 0 ${overviewDashboard.trendChart.width} ${overviewDashboard.trendChart.height}`"
            preserveAspectRatio="none"
            role="img"
            :aria-label="overviewRangeSubtitle(overviewTrendRange)"
          >
            <defs>
              <linearGradient id="pcTrendAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--pc-primary)" stop-opacity="0.28" />
                <stop
                  offset="100%"
                  stop-color="var(--pc-primary)"
                  stop-opacity="0.02"
                />
              </linearGradient>
              <linearGradient id="pcTrendLineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#60a5fa" />
                <stop offset="100%" stop-color="var(--pc-primary)" />
              </linearGradient>
            </defs>
            <g class="pc-overview-chart__grid">
              <line
                v-for="(tick, index) in overviewDashboard.trendChart.yTicks"
                :key="`grid-${index}`"
                :x1="0"
                :x2="overviewDashboard.trendChart.width"
                :y1="tick.y"
                :y2="tick.y"
              />
            </g>
            <path
              class="pc-overview-chart__area"
              :d="overviewDashboard.trendChart.areaPath"
            />
            <path
              class="pc-overview-chart__line"
              :d="overviewDashboard.trendChart.linePath"
              pathLength="100"
            />
            <line
              v-if="overviewTrendHoverPoint"
              class="pc-overview-chart__cursor"
              :x1="overviewTrendHoverPoint.x"
              :x2="overviewTrendHoverPoint.x"
              :y1="overviewDashboard.trendChart.padTop"
              :y2="
                overviewDashboard.trendChart.height -
                overviewDashboard.trendChart.padBottom
              "
            />
            <g class="pc-overview-chart__dots">
              <circle
                v-for="(point, index) in overviewDashboard.trendChart.points"
                :key="`dot-hit-${point.date}`"
                class="pc-overview-chart__dot-hit"
                :cx="point.x"
                :cy="point.y"
                r="14"
                @mouseenter="overviewTrendHoverIndex = index"
                @focus="overviewTrendHoverIndex = index"
              />
              <circle
                v-for="(point, index) in overviewDashboard.trendChart.points"
                :key="`dot-${point.date}`"
                class="pc-overview-chart__dot"
                :class="{ 'is-active': overviewTrendHoverIndex === index }"
                :cx="point.x"
                :cy="point.y"
                r="4.5"
                pointer-events="none"
              />
            </g>
          </svg>
          <div
            v-if="overviewTrendHoverPoint"
            class="pc-overview-chart__tooltip"
            :style="overviewTrendTooltipStyle"
          >
            <strong>{{ formatTrendPointDate(overviewTrendHoverPoint.date) }}</strong>
            <span>{{ formatTrendPointValue(overviewTrendHoverPoint.value) }}</span>
          </div>
        </div>
      </div>
      <div v-if="overviewDashboard.hasTrendData" class="pc-overview-chart__axis">
        <span
          v-for="point in overviewDashboard.trendAxisLabels"
          :key="`axis-${point.date}`"
          class="pc-num"
          :class="{ 'is-active': overviewTrendHoverPoint?.date === point.date }"
        >
          {{ point.label }}
        </span>
      </div>
    </div>
  </article>

  <article class="pc-overview-panel pc-overview-panel--streak pc-overview__detail">
    <div class="pc-streak">
      <header class="pc-streak__head">
        <div class="pc-streak__head-copy">
          <div class="pc-overview-panel__icon is-flame"><i class="bi bi-fire"></i></div>
          <div>
            <h2>使用连击</h2>
            <p>近一年 API 调用活跃情况，颜色越深代表调用越多。</p>
          </div>
        </div>
      </header>

      <div class="pc-streak__metrics">
        <article class="pc-streak__metric">
          <span class="pc-streak__metric-label">当前连击</span>
          <div class="pc-streak__metric-value">
            <PcAnimatedNumber
              tag="strong"
              :value="overviewDashboard.streak.current"
              format="integer"
              :delay="overviewNumberDelay(420)"
              :enabled="overviewNumbersEnabled"
            />
            <em>天</em>
          </div>
        </article>
        <article class="pc-streak__metric">
          <span class="pc-streak__metric-label">最长连击</span>
          <div class="pc-streak__metric-value">
            <PcAnimatedNumber
              tag="strong"
              :value="overviewDashboard.streak.longest"
              format="integer"
              :delay="overviewNumberDelay(480)"
              :enabled="overviewNumbersEnabled"
            />
            <em>天</em>
          </div>
        </article>
        <article class="pc-streak__metric">
          <span class="pc-streak__metric-label">活跃天数</span>
          <div class="pc-streak__metric-value">
            <PcAnimatedNumber
              tag="strong"
              :value="overviewDashboard.streak.activeDays"
              format="integer"
              :delay="overviewNumberDelay(540)"
              :enabled="overviewNumbersEnabled"
            />
            <em>天</em>
          </div>
        </article>
      </div>

      <div class="pc-streak__board">
        <div class="pc-streak__weekdays" aria-hidden="true">
          <span
            v-for="(label, index) in HEATMAP_WEEKDAY_LABELS"
            :key="`weekday-${index}`"
          >
            {{ label }}
          </span>
        </div>
        <div class="pc-streak__heatmap-scroll">
          <div
            class="pc-streak__months"
            :style="{ '--pc-streak-weeks': overviewDashboard.heatmapLayout.weekCount }"
            aria-hidden="true"
          >
            <span
              v-for="marker in overviewDashboard.heatmapLayout.monthMarkers"
              :key="`month-${marker.weekIndex}`"
              class="pc-streak__month"
              :style="{ gridColumn: `${marker.weekIndex + 1} / span 1` }"
            >
              {{ marker.label }}
            </span>
          </div>
          <div
            class="pc-streak__grid"
            role="grid"
            aria-label="近一年 API 使用热力图"
            @mouseleave="overviewStreakHoverCell = null"
          >
            <button
              v-for="cell in overviewDashboard.heatmapCells"
              :key="cell.date"
              type="button"
              class="pc-streak__cell"
              :class="[
                `is-l${cell.level}`,
                { 'is-active': overviewStreakHoverCell?.date === cell.date },
              ]"
              :aria-label="`${formatHeatmapDate(cell.date)}，${heatmapActivityLabel(cell.level)}`"
              @mouseenter="overviewStreakHoverCell = cell"
              @focus="overviewStreakHoverCell = cell"
              @blur="overviewStreakHoverCell = null"
            ></button>
          </div>
        </div>
      </div>

      <footer class="pc-streak__foot">
        <div
          class="pc-streak__hint"
          :class="[
            { 'is-active': overviewStreakHoverCell },
            overviewStreakHoverCell ? `is-l${overviewStreakHoverCell.level}` : null,
          ]"
          aria-live="polite"
        >
          <template v-if="overviewStreakHoverCell">
            <strong class="pc-streak__hint-date">{{
              formatHeatmapDate(overviewStreakHoverCell.date)
            }}</strong>
            <span class="pc-streak__hint-level">{{
              heatmapActivityLabel(overviewStreakHoverCell.level)
            }}</span>
            <span v-if="overviewStreakHoverCell.count" class="pc-streak__hint-count">
              {{ overviewStreakHoverCell.count }} 次调用
            </span>
          </template>
          <template v-else>
            <span class="pc-streak__hint-idle"
              >悬停方块查看具体日期与调用量 · 最近 371 天</span
            >
          </template>
        </div>
        <div class="pc-streak__legend" aria-hidden="true">
          <span class="pc-streak__legend-label">调用量</span>
          <span>少</span>
          <span class="pc-streak__cell is-l0"></span>
          <span class="pc-streak__cell is-l1"></span>
          <span class="pc-streak__cell is-l2"></span>
          <span class="pc-streak__cell is-l3"></span>
          <span class="pc-streak__cell is-l4"></span>
          <span>多</span>
        </div>
      </footer>
    </div>
  </article>

  <article class="pc-overview-panel pc-overview__detail">
    <header class="pc-overview-panel__head">
      <div>
        <h2>用量洞察</h2>
        <p>{{ overviewRangeSubtitle(overviewInsightsRange) }}</p>
      </div>
      <div class="pc-overview-range" role="tablist" aria-label="洞察时间范围">
        <button
          v-for="option in overviewRangeOptions"
          :key="`insights-${option.id}`"
          type="button"
          role="tab"
          class="pc-overview-range__btn"
          :class="{ 'is-active': overviewInsightsRange === option.id }"
          @click="overviewInsightsRange = option.id"
        >
          {{ option.label }}
        </button>
      </div>
    </header>
    <div class="pc-overview-insights">
      <section class="pc-overview-insight-card pc-overview-insight-card--bars">
        <header>
          <div class="pc-overview-panel__icon is-chart">
            <i class="bi bi-bar-chart-line"></i>
          </div>
          <div>
            <h3>模型预估消费</h3>
            <p>仅统计成功/已扣费调用，按所选时间范围汇总预估费用。</p>
          </div>
        </header>
        <div v-if="overviewDashboard.hasInsightsData" class="pc-overview-bars">
          <article
            v-for="(item, index) in overviewDashboard.modelConsumption"
            :key="item.key || item.label"
            class="pc-overview-bar"
          >
            <div class="pc-overview-bar__head">
              <div class="pc-overview-bar__identity">
                <span class="pc-overview-bar__rank">{{ index + 1 }}</span>
                <span class="pc-overview-bar__label" :title="item.key">{{
                  item.label
                }}</span>
              </div>
              <PcAnimatedNumber
                tag="strong"
                class="pc-overview-bar__amount"
                :value="item.value"
                format="usd3"
                :delay="overviewNumberDelay(460 + index * 60)"
                :enabled="overviewNumbersEnabled"
              />
            </div>
            <div class="pc-overview-bar__track" aria-hidden="true">
              <span
                class="pc-overview-bar__fill"
                :style="{
                  width: `${(item.value / overviewDashboard.consumptionMax) * 100}%`,
                }"
              ></span>
            </div>
            <div class="pc-overview-bar__foot">
              <span class="pc-overview-bar__share">
                占总额
                {{
                  overviewDashboard.consumptionTotal > 0
                    ? ((item.value / overviewDashboard.consumptionTotal) * 100).toFixed(
                        1,
                      )
                    : '0.0'
                }}%
              </span>
              <span class="pc-overview-bar__scale">
                相对最高
                {{
                  ((item.value / overviewDashboard.consumptionMax) * 100).toFixed(0)
                }}%
              </span>
            </div>
          </article>
        </div>
        <div v-else class="pc-overview-empty-box">该时间范围暂无调用记录。</div>
      </section>

      <section class="pc-overview-insight-card pc-overview-insight-card--gauge">
        <header>
          <div class="pc-overview-panel__icon is-gauge">
            <i class="bi bi-speedometer2"></i>
          </div>
          <div>
            <h3>缓存率</h3>
            <p>所选时间范围内输入 token 的缓存占比。</p>
          </div>
        </header>
        <div v-if="overviewDashboard.cacheRate > 0" class="pc-overview-gauge">
          <div class="pc-overview-gauge__stage">
            <svg
              class="pc-overview-gauge__svg"
              viewBox="0 0 120 120"
              role="img"
              :aria-label="`缓存率 ${overviewDashboard.cacheRate}%`"
            >
              <defs>
                <linearGradient
                  id="pc-overview-gauge-gradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stop-color="#97ff7c" />
                  <stop offset="100%" stop-color="#54d6c4" />
                </linearGradient>
                <filter
                  id="pc-overview-gauge-glow"
                  x="-30%"
                  y="-30%"
                  width="160%"
                  height="160%"
                >
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <circle
                class="pc-overview-gauge__track-ring"
                cx="60"
                cy="60"
                r="48"
                fill="none"
              />
              <circle
                class="pc-overview-gauge__progress-ring"
                cx="60"
                cy="60"
                r="48"
                fill="none"
                :stroke-dasharray="`${overviewCacheGauge.dash} ${overviewCacheGauge.circumference}`"
                transform="rotate(-90 60 60)"
                filter="url(#pc-overview-gauge-glow)"
              />
            </svg>
            <div class="pc-overview-gauge__readout">
              <PcAnimatedNumber
                tag="strong"
                class="pc-overview-gauge__value"
                :value="overviewDashboard.cacheRate"
                format="percent1"
                :delay="overviewNumberDelay(520)"
                :enabled="overviewNumbersEnabled"
              />
              <span class="pc-overview-gauge__caption">缓存占比</span>
            </div>
          </div>
          <div class="pc-overview-gauge__legend">
            <span class="pc-overview-gauge__legend-item is-hit">
              <i aria-hidden="true"></i>
              已缓存
              <em>{{ overviewCacheGauge.rate.toFixed(1) }}%</em>
            </span>
            <span class="pc-overview-gauge__legend-item is-miss">
              <i aria-hidden="true"></i>
              未缓存
              <em>{{ overviewCacheGauge.missRate.toFixed(1) }}%</em>
            </span>
          </div>
        </div>
        <div v-else class="pc-overview-empty-box">该时间范围暂无调用记录。</div>
      </section>
    </div>
  </article>
</section>
</template>
