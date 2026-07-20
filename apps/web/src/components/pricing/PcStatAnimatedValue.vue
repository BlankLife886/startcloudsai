<script setup>
import PcAnimatedNumber from '@/components/pricing/PcAnimatedNumber.vue'
import { overviewNumberDelay } from '@/features/pricing/pricingNumberMotion'

defineOptions({ inheritAttrs: false })

defineProps({
  card: { type: Object, required: true },
  enabled: { type: Boolean, default: true },
  extraDelay: { type: Number, default: 0 },
  tag: { type: String, default: 'strong' },
})
</script>

<template>
  <PcAnimatedNumber
    v-if="card.animateFormat"
    :tag="tag"
    :value="card.animateValue"
    :format="card.animateFormat"
    :delay="overviewNumberDelay((card.animateDelay || 0) + extraDelay)"
    :enabled="enabled"
    v-bind="$attrs"
  />
  <component v-else :is="tag" class="pc-num" v-bind="$attrs">{{ card.value }}</component>
</template>
