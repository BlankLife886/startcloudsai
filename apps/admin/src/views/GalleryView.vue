<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import { formatTime, SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_TAG } from '@/utils'

interface AdminSubmission {
  id: string
  taskId?: string
  title: string
  status: string
  coverUrl?: string
  mediaUrls?: string[]
  author?: { id: string; username: string | null }
  userEmail?: string
  reason?: string | null
  createdAt: string
}

const filters = reactive({ status: 'pending' })

const { items, loading, hasPrev, hasNext, reset, next, prev, refresh } = usePagedList<AdminSubmission>(
  (cursor) =>
    request<Page<AdminSubmission>>('/api/admin/gallery/submissions', {
      query: { status: filters.status, limit: 12, cursor },
    }),
)

onMounted(reset)

function coverOf(sub: AdminSubmission): string {
  return sub.coverUrl ?? sub.mediaUrls?.[0] ?? ''
}

function previewList(sub: AdminSubmission): string[] {
  const list = sub.mediaUrls?.length ? sub.mediaUrls : sub.coverUrl ? [sub.coverUrl] : []
  return list
}

function authorOf(sub: AdminSubmission): string {
  return sub.author?.username || sub.userEmail || sub.author?.id || '-'
}

async function review(sub: AdminSubmission, action: 'approve' | 'reject' | 'remove') {
  let reason: string | undefined
  if (action === 'approve') {
    await ElMessageBox.confirm(`确认通过「${sub.title}」？通过后将在画廊公开展示。`, '通过审核', {
      type: 'success',
      confirmButtonText: '通过',
      cancelButtonText: '取消',
    })
  } else {
    const tip = action === 'reject' ? '拒绝' : '下架'
    const { value } = await ElMessageBox.prompt(`请填写${tip}原因（将通知作者）`, `${tip}作品`, {
      confirmButtonText: `确认${tip}`,
      cancelButtonText: '取消',
      inputPlaceholder: '例如：内容违规',
      inputValidator: (v: string) => (v && v.trim() ? true : '原因必填'),
    })
    reason = value.trim()
  }
  await request(`/api/admin/gallery/submissions/${sub.id}/review`, {
    method: 'POST',
    body: { action, reason },
  })
  ElMessage.success('操作成功')
  refresh()
}
</script>

<template>
  <div class="page">
    <div class="filter-bar">
      <el-radio-group v-model="filters.status" @change="reset">
        <el-radio-button value="pending">待审核</el-radio-button>
        <el-radio-button value="approved">已通过</el-radio-button>
        <el-radio-button value="rejected">已拒绝</el-radio-button>
        <el-radio-button value="removed">已下架</el-radio-button>
        <el-radio-button value="">全部</el-radio-button>
      </el-radio-group>
      <el-button @click="refresh">刷新</el-button>
    </div>

    <div v-loading="loading" class="grid">
      <el-empty v-if="!loading && items.length === 0" description="暂无投稿" class="grid-empty" />
      <el-card v-for="sub in items" :key="sub.id" shadow="hover" body-style="padding: 0">
        <el-image
          :src="coverOf(sub)"
          :preview-src-list="previewList(sub)"
          fit="cover"
          class="cover"
          preview-teleported
        >
          <template #error>
            <div class="cover-fallback">图片加载失败</div>
          </template>
        </el-image>
        <div class="card-body">
          <div class="card-title" :title="sub.title">{{ sub.title || '（无标题）' }}</div>
          <div class="text-muted">
            {{ authorOf(sub) }} · {{ formatTime(sub.createdAt) }}
          </div>
          <div class="card-footer">
            <el-tag :type="SUBMISSION_STATUS_TAG[sub.status] ?? 'info'" size="small">
              {{ SUBMISSION_STATUS_LABELS[sub.status] ?? sub.status }}
            </el-tag>
            <span>
              <template v-if="sub.status === 'pending'">
                <el-button size="small" type="success" plain @click="review(sub, 'approve')">通过</el-button>
                <el-button size="small" type="danger" plain @click="review(sub, 'reject')">拒绝</el-button>
              </template>
              <el-button
                v-else-if="sub.status === 'approved'"
                size="small"
                type="danger"
                plain
                @click="review(sub, 'remove')"
              >
                下架
              </el-button>
            </span>
          </div>
          <div v-if="sub.reason" class="text-muted" style="margin-top: 4px">原因：{{ sub.reason }}</div>
        </div>
      </el-card>
    </div>

    <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  min-height: 200px;
}

.grid-empty {
  grid-column: 1 / -1;
}

.cover {
  width: 100%;
  aspect-ratio: 4 / 3;
  display: block;
  cursor: zoom-in;
  background: #f0f2f5;
}

.cover-fallback {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  font-size: 12px;
}

.card-body {
  padding: 10px 12px 12px;
}

.card-title {
  font-weight: 600;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}
</style>
