<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import AdminDialog from '@/components/AdminDialog.vue'
import { request } from '@/request'
import { normalizePoints } from '@/utils'
import type { AdminSettings } from './types'
import './settings-dialog.css'

const open = ref(false)
const loading = ref(false)
const saving = ref(false)
const form = reactive({ registrationEnabled: true, signupBonusPoints: 0 })

function hydrate(settings: AdminSettings) {
  form.registrationEnabled = settings.registrationEnabled ?? true
  form.signupBonusPoints = normalizePoints(settings.signupBonusCents)
}

async function load() {
  loading.value = true
  try {
    hydrate(await request<AdminSettings>('/api/v1/admin/settings'))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (loading.value || saving.value) return
  saving.value = true
  try {
    hydrate(
      await request<AdminSettings>('/api/v1/admin/settings', {
        method: 'PUT',
        body: {
          registrationEnabled: form.registrationEnabled,
          signupBonusCents: normalizePoints(form.signupBonusPoints),
        },
      }),
    )
    open.value = false
    ElMessage.success('注册设置已生效')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-button :icon="Setting" @click="open = true">注册设置</el-button>

  <AdminDialog
    v-model="open"
    title="注册设置"
    subtitle="管理注册入口和新账号初始积分"
    :icon="Setting"
    width="620px"
    confirm-text="保存设置"
    :confirm-loading="saving"
    :confirm-disabled="loading"
    @open="load"
    @confirm="save"
  >
    <div v-loading="loading" class="module-settings-form">
      <section class="module-settings-section">
        <div class="module-settings-grid">
          <div class="module-settings-field">
            <div class="module-settings-field__copy">
              <strong>开放用户注册</strong>
              <small>关闭后现有用户仍可登录，新用户不能创建账号</small>
            </div>
            <el-switch v-model="form.registrationEnabled" />
          </div>
          <div class="module-settings-field">
            <div class="module-settings-field__copy">
              <strong>注册赠送积分</strong>
              <small>新账号首次创建时自动发放</small>
            </div>
            <div class="module-settings-control">
              <el-input-number
                v-model="form.signupBonusPoints"
                :min="0"
                :max="1000000"
                :precision="0"
              />
              <span>积分</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </AdminDialog>
</template>
