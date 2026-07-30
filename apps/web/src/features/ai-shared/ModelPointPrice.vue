<script setup>
import { computed } from 'vue'
import { resolveModelPointPricing } from './modelPointPricing'

const props = defineProps({
  model: { type: Object, default: () => ({}) },
  perImage: { type: Boolean, default: true },
  compact: { type: Boolean, default: false },
  prominent: { type: Boolean, default: false },
  light: { type: Boolean, default: false },
})

const price = computed(() => resolveModelPointPricing(props.model))
const suffix = computed(() => (props.perImage ? '/张' : ''))
</script>

<template>
  <span
    v-if="price.configured"
    class="model-point-price"
    :class="{ 'is-compact': compact, 'is-prominent': prominent, 'is-light': light }"
  >
    <template v-if="price.hasDiscount">
      <strong v-if="prominent"
        ><b>{{ price.discount }}</b
        ><span>积分{{ suffix }}</span></strong
      >
      <strong v-else>折扣 {{ price.discount }} 积分{{ suffix }}</strong>
      <del>标准 {{ price.standard }} 积分{{ suffix }}</del>
    </template>
    <strong v-else-if="price.effective === 0">免费</strong>
    <strong v-else-if="prominent"
      ><b>{{ price.effective }}</b
      ><span>积分{{ suffix }}</span></strong
    >
    <strong v-else>{{ price.effective }} 积分{{ suffix }}</strong>
  </span>
</template>

<style scoped>
.model-point-price {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  white-space: nowrap;
}

.model-point-price strong {
  color: #f3b94f;
  font-size: 0.72rem;
  font-weight: 700;
}

.model-point-price del {
  color: rgba(255, 255, 255, 0.38);
  font-size: 0.65rem;
  text-decoration-thickness: 1px;
}

.model-point-price.is-light strong {
  color: #a96000;
}

.model-point-price.is-light del {
  color: rgba(55, 57, 72, 0.48);
}

.model-point-price.is-compact {
  display: grid;
  justify-items: end;
  gap: 1px;
  line-height: 1.25;
}

.model-point-price.is-compact strong {
  font-size: 0.68rem;
}

.model-point-price.is-compact del {
  font-size: 0.6rem;
}

.model-point-price.is-compact.is-prominent {
  min-width: 88px;
  justify-items: end;
  gap: 2px;
}

.model-point-price.is-prominent strong {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 3px;
  line-height: 1;
}

.model-point-price.is-prominent strong b {
  font-size: 1rem;
  font-weight: 800;
}

.model-point-price.is-prominent strong span {
  font-size: 0.64rem;
  font-weight: 700;
}

.model-point-price.is-prominent del {
  font-size: 0.58rem;
}
</style>
