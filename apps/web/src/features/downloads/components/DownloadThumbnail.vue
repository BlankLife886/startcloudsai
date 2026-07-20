<script setup>
import { computed, watch } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import ShareProgressiveImage from '@/features/share/components/ShareProgressiveImage.vue'
import { isAuthenticatedAiMediaUrl } from '@/services/authenticatedMedia'
import {
  isDownloadThumbReady,
  warmDownloadThumb,
} from '@/features/downloads/composables/useDownloadThumbCache'

const props = defineProps({
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  eager: { type: Boolean, default: false },
  maxDimension: { type: Number, default: 320 },
})

const isProtected = computed(() => isAuthenticatedAiMediaUrl(props.src))
const alreadyReady = computed(() => !isProtected.value && isDownloadThumbReady(props.src))

watch(
  () => props.src,
  (value) => {
    if (!isAuthenticatedAiMediaUrl(value)) warmDownloadThumb(value)
  },
  { immediate: true },
)
</script>

<template>
  <AuthenticatedImage
    v-if="isProtected"
    class="download-thumb"
    :src="src"
    :alt="alt"
    :loading="eager ? 'eager' : 'lazy'"
    :fetchpriority="eager ? 'high' : 'auto'"
    :max-dimension="maxDimension"
    root-margin="360px 0px"
  />
  <ShareProgressiveImage
    v-else
    class="download-thumb"
    :src="src"
    :alt="alt"
    :eager="eager || alreadyReady"
  />
</template>
