<script setup lang="ts">
import { ref, watch } from "vue";

// 普通文本框录入非负整数（积分、秒数）：没有加减按钮，只接受数字；输入过程中可以临时清空，
// 失焦时补 0 并按 min / max 收紧。
const props = withDefaults(
  defineProps<{
    modelValue: number | null | undefined;
    min?: number;
    max?: number;
    disabled?: boolean;
    size?: "" | "small" | "default" | "large";
    suffix?: string;
  }>(),
  { min: 0, max: undefined, disabled: false, size: "", suffix: "" },
);
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const text = ref(String(props.modelValue ?? 0));
watch(
  () => props.modelValue,
  (value) => {
    if (text.value === "" || Number(text.value) !== value) text.value = String(value ?? 0);
  },
);

function clamp(value: number): number {
  let next = Math.max(props.min, value);
  if (props.max !== undefined) next = Math.min(props.max, next);
  return next;
}

function onInput(value: string) {
  text.value = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (text.value !== "") emit("update:modelValue", Number(text.value));
}

function onBlur() {
  const next = clamp(Number(text.value || 0));
  text.value = String(next);
  if (next !== props.modelValue) emit("update:modelValue", next);
}
</script>

<template>
  <el-input
    :model-value="text"
    :disabled="disabled"
    :size="size"
    inputmode="numeric"
    autocomplete="off"
    @update:model-value="onInput"
    @blur="onBlur"
  >
    <template v-if="suffix" #suffix>{{ suffix }}</template>
  </el-input>
</template>
