<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { normalizeList, request } from '@/request'
import { fenToYuan, fenToYuanNumber, yuanToFen } from '@/utils'

interface AdminPlan {
  id: string
  code: string
  name: string
  /** topup 充值包 | subscription 订阅（周期每日发放） */
  kind?: 'topup' | 'subscription'
  priceCents: number
  grantCents: number
  bonusCents: number
  durationDays?: number
  dailyGrantCents?: number
  features: string[]
  active?: boolean
  sort: number
}

const loading = ref(false)
const plans = ref<AdminPlan[]>([])

async function load() {
  loading.value = true
  try {
    const data = await request<AdminPlan[] | { items: AdminPlan[] }>('/api/admin/plans')
    plans.value = normalizeList(data).items
  } finally {
    loading.value = false
  }
}

onMounted(load)

// 新建/编辑对话框
const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const form = reactive({
  code: '',
  name: '',
  kind: 'topup' as 'topup' | 'subscription',
  priceYuan: 0,
  grantYuan: 0,
  bonusYuan: 0,
  durationDays: 30,
  dailyGrantYuan: 0,
  featuresText: '',
  active: true,
  sort: 0,
})

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    code: '',
    name: '',
    kind: 'topup',
    priceYuan: 0,
    grantYuan: 0,
    bonusYuan: 0,
    durationDays: 30,
    dailyGrantYuan: 0,
    featuresText: '',
    active: true,
    sort: 0,
  })
  dialogVisible.value = true
}

function openEdit(plan: AdminPlan) {
  editingId.value = plan.id
  Object.assign(form, {
    code: plan.code,
    name: plan.name,
    kind: plan.kind ?? 'topup',
    priceYuan: fenToYuanNumber(plan.priceCents),
    grantYuan: fenToYuanNumber(plan.grantCents),
    bonusYuan: fenToYuanNumber(plan.bonusCents),
    durationDays: plan.durationDays || 30,
    dailyGrantYuan: fenToYuanNumber(plan.dailyGrantCents),
    featuresText: (plan.features ?? []).join('\n'),
    active: plan.active ?? true,
    sort: plan.sort,
  })
  dialogVisible.value = true
}

async function submit() {
  if (!form.code.trim() || !form.name.trim()) {
    ElMessage.warning('请填写套餐 code 与名称')
    return
  }
  if (form.kind === 'subscription' && (form.durationDays < 1 || yuanToFen(form.dailyGrantYuan) < 1)) {
    ElMessage.warning('订阅套餐需填写时长（≥1 天）与每日发放金额（> 0）')
    return
  }
  const body = {
    code: form.code.trim(),
    name: form.name.trim(),
    kind: form.kind,
    priceCents: yuanToFen(form.priceYuan),
    grantCents: form.kind === 'subscription' ? 0 : yuanToFen(form.grantYuan),
    bonusCents: form.kind === 'subscription' ? 0 : yuanToFen(form.bonusYuan),
    durationDays: form.kind === 'subscription' ? form.durationDays : 0,
    dailyGrantCents: form.kind === 'subscription' ? yuanToFen(form.dailyGrantYuan) : 0,
    features: form.featuresText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    active: form.active,
    sort: form.sort,
  }
  submitting.value = true
  try {
    if (editingId.value) {
      await request(`/api/admin/plans/${editingId.value}`, { method: 'PATCH', body })
      ElMessage.success('套餐已更新')
    } else {
      await request('/api/admin/plans', { method: 'POST', body })
      ElMessage.success('套餐已创建')
    }
    dialogVisible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

async function removePlan(plan: AdminPlan) {
  await ElMessageBox.confirm(
    `确认下架套餐「${plan.name}」？下架后用户端不再展示，不影响已完成订单。`,
    '下架套餐',
    { type: 'warning', confirmButtonText: '下架', cancelButtonText: '取消' },
  )
  await request(`/api/admin/plans/${plan.id}`, { method: 'DELETE' })
  ElMessage.success('已下架')
  load()
}
</script>

<template>
  <div class="page">
    <PageCard title="套餐管理" subtitle="用户端充值套餐的定价与上下架">
      <template #actions>
        <el-button type="primary" size="small" @click="openCreate">新建套餐</el-button>
      </template>

      <el-table v-loading="loading" :data="plans" size="small">
        <template #empty>
          <el-empty description="暂无套餐" :image-size="60">
            <div class="empty-sub">点击右上角「新建套餐」创建第一个套餐</div>
          </el-empty>
        </template>
        <el-table-column prop="code" label="Code" width="110" />
        <el-table-column prop="name" label="名称" min-width="130" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="(row.kind ?? 'topup') === 'subscription' ? 'warning' : 'info'" size="small">
              {{ (row.kind ?? 'topup') === 'subscription' ? '订阅' : '充值包' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="价格（元）" width="100" align="right" class-name="col-num">
          <template #default="{ row }">{{ fenToYuan(row.priceCents) }}</template>
        </el-table-column>
        <el-table-column label="权益" min-width="150">
          <template #default="{ row }">
            <span v-if="(row.kind ?? 'topup') === 'subscription'">
              {{ row.durationDays }} 天 · 每日 ¥{{ fenToYuan(row.dailyGrantCents ?? 0) }}
            </span>
            <span v-else>
              入账 ¥{{ fenToYuan(row.grantCents) }}
              <template v-if="row.bonusCents > 0"> + 赠 ¥{{ fenToYuan(row.bonusCents) }}</template>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="卖点" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="f in row.features ?? []" :key="f" size="small" style="margin-right: 4px">
              {{ f }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="上架" width="80">
          <template #default="{ row }">
            <el-tag :type="(row.active ?? true) ? 'success' : 'info'" size="small">
              {{ (row.active ?? true) ? '上架' : '下架' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="sort" label="排序" width="70" align="right" class-name="col-num" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row as AdminPlan)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="removePlan(row as AdminPlan)">下架</el-button>
          </template>
        </el-table-column>
      </el-table>
    </PageCard>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑套餐' : '新建套餐'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="Code" required>
          <el-input v-model="form.code" placeholder="唯一标识，如 basic" :disabled="!!editingId" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如：基础套餐" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.kind" :disabled="!!editingId">
            <el-radio-button value="topup">充值包（立即入账）</el-radio-button>
            <el-radio-button value="subscription">订阅（每日发放）</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="价格（元）">
          <el-input-number v-model="form.priceYuan" :min="0" :max="100000" :precision="2" style="width: 160px" />
          <span class="text-muted" style="margin-left: 8px">= {{ yuanToFen(form.priceYuan) }} 分</span>
        </el-form-item>
        <template v-if="form.kind === 'topup'">
          <el-form-item label="入账（元）">
            <el-input-number v-model="form.grantYuan" :min="0" :max="100000" :precision="2" style="width: 160px" />
            <span class="text-muted" style="margin-left: 8px">支付后入账到钱包的金额</span>
          </el-form-item>
          <el-form-item label="赠送（元）">
            <el-input-number v-model="form.bonusYuan" :min="0" :max="100000" :precision="2" style="width: 160px" />
            <span class="text-muted" style="margin-left: 8px">额外赠送金额</span>
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="时长（天）" required>
            <el-input-number v-model="form.durationDays" :min="1" :max="3650" :step="1" style="width: 160px" />
            <span class="text-muted" style="margin-left: 8px">续购自动顺延到期日</span>
          </el-form-item>
          <el-form-item label="每日发放（元）" required>
            <el-input-number v-model="form.dailyGrantYuan" :min="0" :max="10000" :precision="2" style="width: 160px" />
            <span class="text-muted" style="margin-left: 8px">
              有效期内每天自动入账，合计 ≈ ¥{{ (form.dailyGrantYuan * form.durationDays).toFixed(2) }}
            </span>
          </el-form-item>
        </template>
        <el-form-item label="卖点">
          <el-input v-model="form.featuresText" type="textarea" :rows="3" placeholder="一行一条卖点" />
        </el-form-item>
        <el-form-item label="上架">
          <el-switch v-model="form.active" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :step="1" style="width: 160px" />
          <span class="text-muted" style="margin-left: 8px">数字越小越靠前</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
