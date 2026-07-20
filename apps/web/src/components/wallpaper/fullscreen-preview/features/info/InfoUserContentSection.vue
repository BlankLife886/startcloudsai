<script setup>
import { computed } from 'vue'
import { tagTone } from '@/utils/tagTone'

const props = defineProps({
  userTagsText: { type: String, default: '' },
  dirty: { type: Boolean, default: false },
})

const emit = defineEmits(['update:userTagsText', 'save', 'tag-click'])

const userTagsTextValue = computed({
  get: () => props.userTagsText,
  set: (value) => emit('update:userTagsText', value),
})

const userTags = computed(() =>
  userTagsTextValue.value
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20),
)

function tagClass(tag) {
  return tagTone(tag)
}

function handleKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (props.dirty) emit('save')
  }
}
</script>

<template>
  <section class="user-content-block">
    <div class="user-content-card">
      <input
        v-model.trim="userTagsTextValue"
        type="text"
        placeholder="自定义标签，逗号分隔"
        @keydown="handleKeydown"
      />
      <div v-if="userTags.length" class="user-tags-clickable">
        <button
          v-for="item in userTags"
          :key="item"
          type="button"
          class="preview-info-tag preview-info-tag-clickable"
          :class="tagClass(item)"
          @click="emit('tag-click', item)"
        >
          {{ item }}
        </button>
      </div>
      <button
        type="button"
        class="save-user-content-btn"
        :class="{ 'is-dirty': dirty }"
        :disabled="!dirty"
        @click="emit('save')"
      >
        {{ dirty ? '保存' : '已保存' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.user-content-block {
  display: block;
}

.user-content-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.user-content-card input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.2);
  color: #fff;
  padding: 8px 10px;
  font-size: 0.78rem;
}

.user-content-card input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.user-content-card input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.28);
}

.user-tags-clickable {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.save-user-content-btn {
  align-self: flex-start;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.38);
  font-size: 0.76rem;
  cursor: default;
}

.save-user-content-btn.is-dirty {
  border-color: rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.92);
  cursor: pointer;
}

.save-user-content-btn.is-dirty:hover {
  background: rgba(255, 255, 255, 0.14);
}
</style>
