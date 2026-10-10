<script setup lang="ts">
import { QuestionFilled } from "@element-plus/icons-vue";

/** 标题旁的“?”说明：悬停或键盘聚焦时显示，页面上不再常驻长段说明文字。 */
defineProps<{ content: string }>();
</script>

<template>
  <el-tooltip :content="content" placement="top" :show-after="120" :popper-style="{ maxWidth: '320px', lineHeight: 1.6 }">
    <span class="help-tip" tabindex="0" role="img" :aria-label="content">
      <el-icon><QuestionFilled /></el-icon>
    </span>
  </el-tooltip>
</template>

<style scoped>
.help-tip {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  color: var(--ink-3, var(--el-text-color-secondary));
  font-size: 13px;
  vertical-align: -2px;
  cursor: help;
  outline: none;
}

.help-tip:hover,
.help-tip:focus-visible {
  color: var(--el-color-primary);
}
</style>
