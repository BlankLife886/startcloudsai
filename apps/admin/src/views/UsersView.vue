<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import { fenToYuan, formatTime, yuanToFen } from '@/utils'

interface AdminUser {
  id: string
  email: string
  username: string | null
  role: string
  status: string
  balanceCents?: number
  createdAt: string
}

const filters = reactive({ search: '', status: '' })

const { items, loading, hasPrev, hasNext, reset, next, prev, refresh } = usePagedList<AdminUser>(
  (cursor) =>
    request<Page<AdminUser>>('/api/admin/users', {
      query: { search: filters.search, status: filters.status, limit: 20, cursor },
    }),
)

onMounted(reset)

async function toggleBan(user: AdminUser) {
  const banning = user.status !== 'banned'
  await ElMessageBox.confirm(
    banning ? `确认封禁用户 ${user.email}？封禁后无法登录与提交任务。` : `确认解封用户 ${user.email}？`,
    banning ? '封禁用户' : '解封用户',
    { type: 'warning', confirmButtonText: banning ? '封禁' : '解封', cancelButtonText: '取消' },
  )
  await request(`/api/admin/users/${user.id}`, {
    method: 'PATCH',
    body: { status: banning ? 'banned' : 'active' },
  })
  ElMessage.success(banning ? '已封禁' : '已解封')
  refresh()
}

// 调整余额对话框
const adjustVisible = ref(false)
const adjustTarget = ref<AdminUser | null>(null)
const adjustForm = reactive({ deltaYuan: 0, reason: '' })
const adjustSubmitting = ref(false)

const adjustCents = computed(() => yuanToFen(adjustForm.deltaYuan))

function openAdjust(user: AdminUser) {
  adjustTarget.value = user
  adjustForm.deltaYuan = 0
  adjustForm.reason = ''
  adjustVisible.value = true
}

async function submitAdjust() {
  if (!adjustTarget.value) return
  if (adjustCents.value === 0) {
    ElMessage.warning('调整金额不能为 0')
    return
  }
  if (!adjustForm.reason.trim()) {
    ElMessage.warning('请填写调整原因')
    return
  }
  adjustSubmitting.value = true
  try {
    await request(`/api/admin/users/${adjustTarget.value.id}/wallet-adjust`, {
      method: 'POST',
      body: { deltaCents: adjustCents.value, reason: adjustForm.reason.trim() },
    })
    ElMessage.success('余额调整成功')
    adjustVisible.value = false
    refresh()
  } finally {
    adjustSubmitting.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="filter-bar">
      <el-input
        v-model="filters.search"
        placeholder="搜索邮箱 / 用户名"
        clearable
        style="width: 240px"
        @keyup.enter="reset"
        @clear="reset"
      />
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 120px" @change="reset">
        <el-option label="正常" value="active" />
        <el-option label="已封禁" value="banned" />
      </el-select>
      <el-button type="primary" @click="reset">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="items" size="small">
      <template #empty>
        <el-empty description="暂无用户" :image-size="60" />
      </template>
      <el-table-column prop="email" label="邮箱" min-width="200" />
      <el-table-column prop="username" label="用户名" min-width="120">
        <template #default="{ row }">{{ row.username || '-' }}</template>
      </el-table-column>
      <el-table-column label="角色" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.role === 'admin'" type="danger" size="small">管理员</el-tag>
          <span v-else>用户</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'banned' ? 'danger' : 'success'" size="small">
            {{ row.status === 'banned' ? '已封禁' : '正常' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="余额（元）" width="110">
        <template #default="{ row }">{{ fenToYuan(row.balanceCents) }}</template>
      </el-table-column>
      <el-table-column label="注册时间" width="170">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openAdjust(row as AdminUser)">调整余额</el-button>
          <el-button
            size="small"
            :type="row.status === 'banned' ? 'success' : 'danger'"
            plain
            @click="toggleBan(row as AdminUser)"
          >
            {{ row.status === 'banned' ? '解封' : '封禁' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />

    <el-dialog v-model="adjustVisible" title="调整余额" width="440px">
      <p v-if="adjustTarget" class="text-muted" style="margin-top: 0">
        用户：{{ adjustTarget.email }}（当前余额 {{ fenToYuan(adjustTarget.balanceCents) }} 元）
      </p>
      <el-form label-width="90px">
        <el-form-item label="金额（元）" required>
          <el-input-number v-model="adjustForm.deltaYuan" :precision="2" :step="1" style="width: 200px" />
          <div class="text-muted">正数入账、负数扣减；实际写入 {{ adjustCents }} 分，记入钱包账本</div>
        </el-form-item>
        <el-form-item label="原因" required>
          <el-input v-model="adjustForm.reason" type="textarea" :rows="2" placeholder="必填，例如：活动补偿" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjustVisible = false">取消</el-button>
        <el-button type="primary" :loading="adjustSubmitting" @click="submitAdjust">确认调整</el-button>
      </template>
    </el-dialog>
  </div>
</template>
