<script setup>
import { computed } from 'vue'

// 方案保存和复用是另一条业务线，和参数表单拆开后更容易维护。
const props = defineProps({
  loading: { type: Boolean, default: false },
  recipeName: { type: String, default: '' },
  recipes: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:recipeName', 'save-recipe', 'apply-recipe', 'remove-recipe'])

const recipeNameValue = computed({
  get: () => props.recipeName,
  set: (value) => emit('update:recipeName', value),
})
</script>

<template>
  <section class="ai-recipe-box">
    <div class="ai-recipe-input-row">
      <input
        v-model.trim="recipeNameValue"
        type="text"
        placeholder="保存当前设置为方案（如：1K 清晰版）"
      />
      <button type="button" class="ai-mini-btn" :disabled="loading" @click="emit('save-recipe')">
        保存方案
      </button>
    </div>
    <div v-if="recipes.length" class="ai-recipe-list">
      <button
        v-for="recipe in recipes"
        :key="recipe.id"
        type="button"
        class="ai-recipe-item"
        @click="emit('apply-recipe', recipe)"
      >
        <span>{{ recipe.name }}</span>
        <i class="bi bi-x-circle" @click.stop="emit('remove-recipe', recipe.id)"></i>
      </button>
    </div>
  </section>
</template>

<style scoped>
.ai-recipe-box {
  display: grid;
  gap: 6px;
}

.ai-recipe-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
}

.ai-recipe-input-row input {
  min-width: 0;
  height: 30px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  padding: 0 8px;
  font-size: 0.75rem;
}

.ai-mini-btn {
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 0.72rem;
}

.ai-recipe-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-recipe-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.82);
  padding: 4px 8px;
  font-size: 0.7rem;
}

.ai-recipe-item i {
  opacity: 0.72;
}
</style>
