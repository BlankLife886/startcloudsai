<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight, Refresh } from '@element-plus/icons-vue';
import AdminDialog from './AdminDialog.vue';
import { request } from '@/request';
import { formatTime } from '@/utils';
import { planChanges, versionSummary, type PlanHistoryEntry } from '@/planHistory';

const props = defineProps<{ modelValue: boolean; plan: { id: string; name: string } | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const router = useRouter();
const entries = ref<PlanHistoryEntry[]>([]), expanded = ref<number[]>([]);
const loading = ref(false), error = ref(''), next = ref(0), full = ref(false);
let generation = 0;
async function load(more = false) {
  if (!props.plan) return;
  const own = ++generation;
  loading.value = true; error.value = '';
  try {
    const result = await request<{ items: PlanHistoryEntry[]; nextBefore: number }>(`/api/v1/admin/plans/${props.plan.id}/versions`, { query: { before: more ? next.value : 0 } });
    if (own !== generation) return;
    entries.value = more ? [...entries.value, ...result.items] : result.items;
    next.value = result.nextBefore;
    if (!more) expanded.value = result.items[0] ? [result.items[0].revision] : [];
  } catch (e) { if (own === generation) error.value = e instanceof Error ? e.message : '加载失败'; }
  finally { if (own === generation) loading.value = false; }
}
watch(() => [props.modelValue, props.plan?.id], () => {
  ++generation;
  if (props.modelValue) { entries.value = []; next.value = 0; full.value = false; void load(); }
});
function orders(entry: PlanHistoryEntry) {
  emit('update:modelValue',false);
  void router.push({ path:'/orders', query:{ planId:props.plan!.id,planRevision:String(entry.revision),planName:props.plan!.name } });
}
</script>

<template>
  <AdminDialog :model-value="modelValue" title="套餐变更记录" :subtitle="plan?.name" width="960px" hide-footer @update:model-value="emit('update:modelValue',$event)">
    <div class="history-toolbar">
      <el-checkbox v-model="full">显示全部配置</el-checkbox>
      <el-button :icon="Refresh" :loading="loading" @click="load(false)">刷新记录</el-button>
    </div>
    <div v-if="error" role="alert" class="history-error">{{ error }} <el-button link type="primary" @click="load(entries.length > 0)">重试</el-button></div>
    <div v-loading="loading" class="history-body" :aria-busy="loading">
      <el-empty v-if="!entries.length && !loading && !error" description="暂无变更记录" />
      <el-collapse v-model="expanded">
        <el-collapse-item v-for="entry in entries" :key="entry.revision" :name="entry.revision">
          <template #title>
            <div class="history-heading">
              <div class="history-title"><strong>第 {{ entry.revision }} 版</strong><el-tag v-if="entry.current" size="small" type="success">当前版本</el-tag><span>{{ versionSummary(entry) }}</span></div>
              <div class="history-meta"><time>{{ formatTime(entry.createdAt) }}</time><span>{{ entry.actorName || (entry.action === 'legacy' ? '历史未记录' : '系统 / 非后台操作') }}</span></div>
            </div>
          </template>
          <div class="history-context">
            <span>{{ entry.previousRevision ? `第 ${entry.previousRevision} 版 → 第 ${entry.revision} 版` : '首次保留的配置' }}</span>
            <el-button v-if="entry.orderCount" link type="primary" @click="orders(entry)">{{ entry.orderCount }} 笔关联订单 <el-icon><ArrowRight /></el-icon></el-button>
            <span v-else>无关联订单</span>
          </div>
          <table class="history-diff">
            <thead><tr><th>配置项目</th><th v-if="entry.previous">修改前</th><th>{{ entry.previous ? '修改后' : '记录值' }}</th></tr></thead>
            <tbody><tr v-for="row in planChanges(entry,full)" :key="row.key" :class="{ 'is-changed':row.changed && entry.previous }"><th scope="row">{{ row.label }}</th><td v-if="entry.previous" class="history-before">{{ row.before }}</td><td>{{ row.after }}</td></tr></tbody>
          </table>
        </el-collapse-item>
      </el-collapse>
    </div>
    <div v-if="next" class="history-more"><el-button :loading="loading" @click="load(true)">加载更早记录</el-button></div>
  </AdminDialog>
</template>

<style scoped>
.history-toolbar,.history-context { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.history-toolbar { padding-bottom:12px; }
.history-body { min-height:120px; }
.history-heading { padding:14px 12px 14px 0; min-width:0; line-height:1.6; }
.history-title { display:flex; align-items:center; flex-wrap:wrap; gap:8px; color:var(--el-text-color-primary); }
.history-title strong { font-size:14px; }
.history-meta { display:flex; flex-wrap:wrap; column-gap:16px; color:var(--el-text-color-secondary); font-size:12px; overflow-wrap:anywhere; }
.history-body :deep(.el-collapse-item__header) { height:auto; min-height:76px; }
.history-body :deep(.el-collapse-item__content) { padding-bottom:18px; }
.history-context { margin:0 0 10px; color:var(--el-text-color-secondary); font-size:12px; }
.history-diff { width:100%; table-layout:fixed; border-collapse:collapse; font-size:13px; }
.history-diff th,.history-diff td { text-align:left; vertical-align:top; padding:10px 12px; overflow-wrap:anywhere; white-space:pre-wrap; border-bottom:1px solid var(--el-border-color-lighter); }
.history-diff th { font-weight:500; }
.history-diff thead { background:var(--el-fill-color-light); color:var(--el-text-color-secondary); }
.history-diff th:first-child { width:30%; }
.history-before { color:var(--el-text-color-secondary); }
.history-diff .is-changed td:last-child { color:var(--el-color-primary); background:var(--el-color-primary-light-9); font-weight:500; }
.history-more { text-align:center; padding-top:16px; }
.history-error { color:var(--el-color-danger); padding:12px 0; }
@media(max-width:600px) { .history-diff th,.history-diff td { padding:8px 6px; font-size:12px; } .history-title > span:last-child { flex-basis:100%; } }
</style>
