<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { normalizeList, request } from '@/request'
import { formatTime } from '@/utils'

const activeTab = ref('announcements')

// ---------- 公告 ----------
interface Announcement {
  id: string
  title: string
  body: string
  active?: boolean
  createdAt?: string
}

const annLoading = ref(false)
const announcements = ref<Announcement[]>([])

async function loadAnnouncements() {
  annLoading.value = true
  try {
    const data = await request<Announcement[] | { items: Announcement[] }>('/api/admin/announcements')
    announcements.value = normalizeList(data).items
  } finally {
    annLoading.value = false
  }
}

const annDialogVisible = ref(false)
const annEditingId = ref<string | null>(null)
const annSubmitting = ref(false)
const annForm = reactive({ title: '', body: '', active: true })

function openAnnCreate() {
  annEditingId.value = null
  Object.assign(annForm, { title: '', body: '', active: true })
  annDialogVisible.value = true
}

function openAnnEdit(item: Announcement) {
  annEditingId.value = item.id
  Object.assign(annForm, { title: item.title, body: item.body, active: item.active ?? true })
  annDialogVisible.value = true
}

async function submitAnn() {
  if (!annForm.title.trim() || !annForm.body.trim()) {
    ElMessage.warning('请填写标题与内容')
    return
  }
  const body = { title: annForm.title.trim(), body: annForm.body.trim(), active: annForm.active }
  annSubmitting.value = true
  try {
    if (annEditingId.value) {
      await request(`/api/admin/announcements/${annEditingId.value}`, { method: 'PATCH', body })
      ElMessage.success('公告已更新')
    } else {
      await request('/api/admin/announcements', { method: 'POST', body })
      ElMessage.success('公告已发布')
    }
    annDialogVisible.value = false
    loadAnnouncements()
  } finally {
    annSubmitting.value = false
  }
}

async function removeAnn(item: Announcement) {
  await ElMessageBox.confirm(`确认删除公告「${item.title}」？`, '删除公告', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
  await request(`/api/admin/announcements/${item.id}`, { method: 'DELETE' })
  ElMessage.success('已删除')
  loadAnnouncements()
}

// ---------- 更新说明 changelog ----------
interface ChangelogEntry {
  id: string
  version: string
  date: string
  tag: string
  title: string
  summary: string
  items: string[]
}

const TAG_LABELS: Record<string, string> = { feature: '新功能', experience: '体验优化' }

const logLoading = ref(false)
const changelog = ref<ChangelogEntry[]>([])

async function loadChangelog() {
  logLoading.value = true
  try {
    const data = await request<ChangelogEntry[] | { items: ChangelogEntry[] }>('/api/admin/changelog')
    changelog.value = normalizeList(data).items
  } finally {
    logLoading.value = false
  }
}

const logDialogVisible = ref(false)
const logEditingId = ref<string | null>(null)
const logSubmitting = ref(false)
const logForm = reactive({
  version: '',
  date: '',
  tag: 'feature',
  title: '',
  summary: '',
  itemsText: '',
})

function openLogCreate() {
  logEditingId.value = null
  Object.assign(logForm, {
    version: '',
    date: new Date().toISOString().slice(0, 10),
    tag: 'feature',
    title: '',
    summary: '',
    itemsText: '',
  })
  logDialogVisible.value = true
}

function openLogEdit(entry: ChangelogEntry) {
  logEditingId.value = entry.id
  Object.assign(logForm, {
    version: entry.version,
    date: entry.date,
    tag: entry.tag,
    title: entry.title,
    summary: entry.summary,
    itemsText: (entry.items ?? []).join('\n'),
  })
  logDialogVisible.value = true
}

async function submitLog() {
  if (!logForm.version.trim() || !logForm.date || !logForm.title.trim()) {
    ElMessage.warning('请填写版本号、日期与标题')
    return
  }
  const body = {
    version: logForm.version.trim(),
    date: logForm.date,
    tag: logForm.tag,
    title: logForm.title.trim(),
    summary: logForm.summary.trim(),
    items: logForm.itemsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  }
  logSubmitting.value = true
  try {
    if (logEditingId.value) {
      await request(`/api/admin/changelog/${logEditingId.value}`, { method: 'PATCH', body })
      ElMessage.success('更新说明已保存')
    } else {
      await request('/api/admin/changelog', { method: 'POST', body })
      ElMessage.success('更新说明已发布')
    }
    logDialogVisible.value = false
    loadChangelog()
  } finally {
    logSubmitting.value = false
  }
}

async function removeLog(entry: ChangelogEntry) {
  await ElMessageBox.confirm(`确认删除更新说明 ${entry.version}「${entry.title}」？`, '删除更新说明', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
  await request(`/api/admin/changelog/${entry.id}`, { method: 'DELETE' })
  ElMessage.success('已删除')
  loadChangelog()
}

onMounted(() => {
  loadAnnouncements()
  loadChangelog()
})
</script>

<template>
  <div class="page">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="公告" name="announcements">
        <PageCard title="全站公告" subtitle="展示在用户端顶部的运营公告">
          <template #actions>
            <el-button type="primary" size="small" @click="openAnnCreate">发布公告</el-button>
          </template>
          <el-table v-loading="annLoading" :data="announcements" size="small">
            <template #empty>
              <el-empty description="暂无公告" :image-size="60">
                <div class="empty-sub">点击右上角「发布公告」创建第一条公告</div>
              </el-empty>
            </template>
            <el-table-column prop="title" label="标题" min-width="180" />
            <el-table-column prop="body" label="内容" min-width="280" show-overflow-tooltip />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="(row.active ?? true) ? 'success' : 'info'" size="small">
                  {{ (row.active ?? true) ? '生效中' : '已停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="创建时间" width="170">
              <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="openAnnEdit(row as Announcement)">编辑</el-button>
                <el-button size="small" type="danger" plain @click="removeAnn(row as Announcement)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </PageCard>
      </el-tab-pane>

      <el-tab-pane label="更新说明" name="changelog">
        <PageCard title="更新说明" subtitle="用户端「更新说明」页的版本条目">
          <template #actions>
            <el-button type="primary" size="small" @click="openLogCreate">新增条目</el-button>
          </template>
          <el-table v-loading="logLoading" :data="changelog" size="small">
            <template #empty>
              <el-empty description="暂无更新说明" :image-size="60">
                <div class="empty-sub">点击右上角「新增条目」发布第一条更新说明</div>
              </el-empty>
            </template>
            <el-table-column prop="version" label="版本" width="100" />
            <el-table-column prop="date" label="日期" width="120" />
            <el-table-column label="类型" width="100">
              <template #default="{ row }">
                <el-tag :type="row.tag === 'feature' ? 'primary' : 'success'" size="small">
                  {{ TAG_LABELS[row.tag] ?? row.tag }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="标题" min-width="160" />
            <el-table-column prop="summary" label="摘要" min-width="220" show-overflow-tooltip />
            <el-table-column label="条目数" width="80" align="right" class-name="col-num">
              <template #default="{ row }">{{ row.items?.length ?? 0 }}</template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="openLogEdit(row as ChangelogEntry)">编辑</el-button>
                <el-button size="small" type="danger" plain @click="removeLog(row as ChangelogEntry)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </PageCard>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="annDialogVisible" :title="annEditingId ? '编辑公告' : '发布公告'" width="520px">
      <el-form label-width="70px">
        <el-form-item label="标题" required>
          <el-input v-model="annForm.title" />
        </el-form-item>
        <el-form-item label="内容" required>
          <el-input v-model="annForm.body" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="生效">
          <el-switch v-model="annForm.active" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="annDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="annSubmitting" @click="submitAnn">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="logDialogVisible" :title="logEditingId ? '编辑更新说明' : '新增更新说明'" width="560px">
      <el-form label-width="80px">
        <el-form-item label="版本号" required>
          <el-input v-model="logForm.version" placeholder="如 1.4.0" style="width: 200px" />
        </el-form-item>
        <el-form-item label="日期" required>
          <el-date-picker v-model="logForm.date" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="logForm.tag" style="width: 200px">
            <el-option label="新功能" value="feature" />
            <el-option label="体验优化" value="experience" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="logForm.title" />
        </el-form-item>
        <el-form-item label="摘要">
          <el-input v-model="logForm.summary" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="条目">
          <el-input v-model="logForm.itemsText" type="textarea" :rows="4" placeholder="一行一条改动说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="logDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="logSubmitting" @click="submitLog">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
