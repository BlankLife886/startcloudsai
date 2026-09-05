<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import AdminDialog from '@/components/AdminDialog.vue'
import { request } from '@/request'

interface ProfileRules {
  version: number
  newUserDays: number
  activationDays: number
  activeDays: number
  churnRiskDays: number
  dormantDays: number
  frequentFailureMinRuns: number
  frequentFailureRatePercent: number
  powerUserActiveDays30: number
  powerUserSuccessfulRuns30: number
  powerUserFeatureDiversity30: number
  highValuePercentile: number
}

interface AdminSettings {
  userProfileRules: ProfileRules
}

const visible = ref(false)
const loading = ref(false)
const saving = ref(false)
const form = reactive<ProfileRules>({
  version: 1,
  newUserDays: 3,
  activationDays: 7,
  activeDays: 7,
  churnRiskDays: 14,
  dormantDays: 30,
  frequentFailureMinRuns: 5,
  frequentFailureRatePercent: 40,
  powerUserActiveDays30: 7,
  powerUserSuccessfulRuns30: 20,
  powerUserFeatureDiversity30: 2,
  highValuePercentile: 90,
})

async function open() {
  visible.value = true
  loading.value = true
  try {
    const settings = await request<AdminSettings>('/api/v1/admin/settings')
    Object.assign(form, settings.userProfileRules)
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const settings = await request<AdminSettings>('/api/v1/admin/settings', {
      method: 'PUT',
      body: { userProfileRules: form },
    })
    Object.assign(form, settings.userProfileRules)
    visible.value = false
    ElMessage.success('画像规则已保存，用户画像将在后台逐步重新计算')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-button :icon="Setting" @click="open">画像规则</el-button>
  <AdminDialog
    v-model="visible"
    title="用户画像规则"
    subtitle="规则只使用真实行为数据，修改后由后台低频重新计算"
    :icon="Setting"
    width="720px"
    confirm-text="保存规则"
    :confirm-loading="saving"
    @confirm="save"
  >
    <div v-loading="loading" class="profile-rule-form">
      <section>
        <header>生命周期</header>
        <div class="rule-grid">
          <el-form-item label="新用户范围">
            <el-input-number v-model="form.newUserDays" :min="1" :max="14" />
            <span>天</span>
          </el-form-item>
          <el-form-item label="激活观察期">
            <el-input-number v-model="form.activationDays" :min="1" :max="30" />
            <span>天</span>
          </el-form-item>
          <el-form-item label="活跃范围">
            <el-input-number v-model="form.activeDays" :min="1" :max="30" />
            <span>天</span>
          </el-form-item>
          <el-form-item label="流失风险">
            <el-input-number v-model="form.churnRiskDays" :min="2" :max="90" />
            <span>天未成功</span>
          </el-form-item>
          <el-form-item label="沉默用户">
            <el-input-number v-model="form.dormantDays" :min="7" :max="365" />
            <span>天未成功</span>
          </el-form-item>
        </div>
      </section>

      <section>
        <header>价值与质量</header>
        <div class="rule-grid">
          <el-form-item label="高价值用户">
            <el-input-number v-model="form.highValuePercentile" :min="50" :max="99" />
            <span>百分位以上</span>
          </el-form-item>
          <el-form-item label="失败最小样本">
            <el-input-number v-model="form.frequentFailureMinRuns" :min="3" :max="100" />
            <span>次</span>
          </el-form-item>
          <el-form-item label="高频失败率">
            <el-input-number v-model="form.frequentFailureRatePercent" :min="10" :max="100" />
            <span>%</span>
          </el-form-item>
        </div>
      </section>

      <section>
        <header>深度用户</header>
        <div class="rule-grid">
          <el-form-item label="30日活跃">
            <el-input-number v-model="form.powerUserActiveDays30" :min="1" :max="30" />
            <span>天</span>
          </el-form-item>
          <el-form-item label="30日成功">
            <el-input-number v-model="form.powerUserSuccessfulRuns30" :min="1" :max="10000" />
            <span>次</span>
          </el-form-item>
          <el-form-item label="使用功能">
            <el-input-number v-model="form.powerUserFeatureDiversity30" :min="1" :max="10" />
            <span>类</span>
          </el-form-item>
        </div>
      </section>
    </div>
  </AdminDialog>
</template>

<style scoped>
.profile-rule-form {
  display: grid;
  gap: 22px;
}

.profile-rule-form section {
  display: grid;
  gap: 12px;
}

.profile-rule-form header {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}

.rule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
}

.rule-grid :deep(.el-form-item) {
  margin: 0;
}

.rule-grid :deep(.el-form-item__content) {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
}

.rule-grid :deep(.el-input-number) {
  width: 130px;
}

.rule-grid span {
  color: var(--ink-3);
  font-size: 12px;
  white-space: nowrap;
}

@media (max-width: 680px) {
  .rule-grid {
    grid-template-columns: 1fr;
  }
}
</style>
