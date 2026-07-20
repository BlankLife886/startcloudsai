<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { normalizeList, request } from '@/request'
import { fenToYuan, fenToYuanNumber, yuanToFen } from '@/utils'

interface AdminPlan {
  id: string
  code: string
  name: string
  priceCents: number
  grantCents: number
  bonusCents: number
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
  priceYuan: 0,
  grantYuan: 0,
  bonusYuan: 0,
  featuresText: '',
  active: true,
  sort: 0,
})

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    code: '',
    name: '',
    priceYuan: 0,
    grantYuan: 0,
    bonusYuan: 0,
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
    priceYuan: fenToYuanNumber(plan.priceCents),
    grantYuan: fenToYuanNumber(plan.grantCents),
    bonusYuan: fenToYuanNumber(plan.bonusCents),
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
  const body = {
    code: form.code.trim(),
    name: form.name.trim(),
    priceCents: yuanToFen(form.priceYuan),
    grantCents: yuanToFen(form.grantYuan),
    bonusCents: yuanToFen(form.bonusYuan),
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
        <el-table-column prop="code" label="Code" width="120" />
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="价格（元）" width="100" align="right" class-name="col-num">
          <template #default="{ row }">{{ fenToYuan(row.priceCents) }}</template>
        </el-table-column>
        <el-table-column label="入账（元）" width="100" align="right" class-name="col-num">
          <template #default="{ row }">{{ fenToYuan(row.grantCents) }}</template>
        </el-table-column>
        <el-table-column label="赠送（元）" width="100" align="right" class-name="col-num">
          <template #default="{ row }">{{ fenToYuan(row.bonusCents) }}</template>
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
        <el-form-item label="价格（元）">
          <el-input-number v-model="form.priceYuan" :min="0" :precision="2" style="width: 160px" />
          <span class="text-muted" style="margin-left: 8px">= {{ yuanToFen(form.priceYuan) }} 分</span>
        </el-form-item>
        <el-form-item label="入账（元）">
          <el-input-number v-model="form.grantYuan" :min="0" :precision="2" style="width: 160px" />
          <span class="text-muted" style="margin-left: 8px">支付后入账到钱包的金额</span>
        </el-form-item>
        <el-form-item label="赠送（元）">
          <el-input-number v-model="form.bonusYuan" :min="0" :precision="2" style="width: 160px" />
          <span class="text-muted" style="margin-left: 8px">额外赠送金额</span>
        </el-form-item>
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
