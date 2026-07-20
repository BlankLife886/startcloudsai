import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const vite = await createServer({
  root,
  server: { middlewareMode: true },
  appType: 'custom',
})

try {
  const [{ useWallpaperTasks }, { ref }] = await Promise.all([
    vite.ssrLoadModule('/src/features/ai-wallpaper/composables/useWallpaperTasks.js'),
    import('vue'),
  ])
  const calls = []
  const pending = []
  let activeRequests = 0
  let maxActiveRequests = 0

  const api = useWallpaperTasks({
    authStore: { isAuthenticated: false },
    settingsStore: {},
    outputType: ref('image'),
    inputMode: ref('text'),
    prompt: ref('并发测试'),
    imageCount: ref(4),
    imageDispatchModel: ref('test-image-model'),
    publicModelOptions: ref([]),
    canCreateTask: ref(true),
    composePrompt: () => 'concurrency test',
    ensureWallpaperBudgetAvailable: async () => {},
    syncState: async () => {},
    notify: { success() {}, warning() {}, error() {}, info() {} },
    createServerAiJobRequest(payload) {
      calls.push(payload)
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      return new Promise((resolve) => {
        pending.push(() => {
          activeRequests -= 1
          resolve({
            job: {
              id: `job-${calls.indexOf(payload) + 1}`,
              status: 'completed',
              estimatedCostUsd: payload.estimatedCostUsd,
            },
          })
        })
      })
    },
  })

  const creation = api.createTask()
  for (let attempt = 0; attempt < 50 && calls.length < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  assert.equal(calls.length, 4, '应创建 4 个独立服务端任务')
  assert.equal(maxActiveRequests, 4, '4 个请求应在任一请求完成前全部启动')
  assert.equal(new Set(calls.map((call) => call.input.batchId)).size, 1)
  calls.forEach((call, index) => {
    assert.equal(call.input.count, 1)
    assert.equal(call.input.n, 1)
    assert.equal(call.params.count, 1)
    assert.equal(call.params.n, 1)
    assert.equal(call.units, 1)
    assert.equal(call.input.batchIndex, index)
    assert.equal(call.input.batchSize, 4)
  })

  pending.forEach((resolve) => resolve())
  await creation
  assert.equal(api.tasks.value.length, 4)
  assert.equal(api.tasks.value.filter((task) => task.serverJobId).length, 4)
  assert.deepEqual(
    api.tasks.value.map((task) => task.count),
    [1, 1, 1, 1],
  )

  const partialCalls = []
  const partialPending = []
  const partialApi = useWallpaperTasks({
    authStore: { isAuthenticated: false },
    settingsStore: {},
    outputType: ref('image'),
    inputMode: ref('text'),
    prompt: ref('局部失败测试'),
    imageCount: ref(4),
    imageDispatchModel: ref('test-image-model'),
    publicModelOptions: ref([]),
    canCreateTask: ref(true),
    composePrompt: () => 'partial failure test',
    ensureWallpaperBudgetAvailable: async () => {},
    syncState: async () => {},
    notify: { success() {}, warning() {}, error() {}, info() {} },
    createServerAiJobRequest(payload) {
      const index = partialCalls.push(payload) - 1
      return new Promise((resolve, reject) => {
        partialPending.push(() => {
          if (index === 1) {
            reject(new Error('single slot rejected'))
            return
          }
          resolve({ job: { id: `partial-job-${index + 1}`, status: 'completed' } })
        })
      })
    },
  })
  const partialCreation = partialApi.createTask()
  for (let attempt = 0; attempt < 50 && partialCalls.length < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.equal(partialCalls.length, 4)
  partialPending.forEach((settle) => settle())
  await partialCreation
  assert.equal(partialApi.tasks.value.filter((task) => task.serverJobId).length, 3)
  assert.equal(partialApi.tasks.value.filter((task) => task.status === 'failed').length, 1)

  console.log('wallpaper concurrency contract: ok')
} finally {
  await vite.close()
}
