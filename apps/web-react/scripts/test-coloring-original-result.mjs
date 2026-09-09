import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const vite = await createServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
})

try {
  const [{ taskToLegacyJob }, { hydrateColoringHistoryItem, mapColoringJobToHistory }] =
    await Promise.all([
      vite.ssrLoadModule('/src/legacy-modules/services/aiWallpaper.js'),
      vite.ssrLoadModule(
        '/src/legacy-modules/features/ai-illustration-coloring/domain/mapColoringJobToHistory.js',
      ),
    ])

  const thumbnailUrl = 'https://media.example.test/tasks/result-thumbnail.jpg'
  const originalUrl = 'https://media.example.test/tasks/result-original.png'
  const job = taskToLegacyJob({
    id: 'coloring-original-result-test',
    type: 'image_generation',
    status: 'succeeded',
    params: { _kind: 'illustration_coloring', styleId: 'coloring' },
    outputUrls: [originalUrl],
    originalUrls: [originalUrl],
    thumbnailUrls: [thumbnailUrl],
  })

  assert.equal(job.resultMediaUrl, thumbnailUrl, '测试任务必须保留新接口的缩略图字段语义')
  assert.equal(job.originalMediaUrl, originalUrl, '测试任务必须提供独立原图字段')

  const mapped = mapColoringJobToHistory(job, {
    existingItem: {
      id: 'existing-coloring-item',
      status: 'running',
      resultUrl: thumbnailUrl,
      outputs: [thumbnailUrl],
    },
  })
  assert.equal(mapped.resultUrl, originalUrl, '完成任务进入画布时必须使用原图')
  assert.equal(mapped.outputs[0], originalUrl, '输出列表首项必须是原图')

  const hydrated = await hydrateColoringHistoryItem(mapped, job)
  assert.equal(hydrated.resultUrl, originalUrl, '恢复历史任务时必须继续使用原图')
  assert.equal(hydrated.resultRemoteUrl, originalUrl, '持久化结果地址必须指向原图')

  console.log('coloring original result tests passed')
} finally {
  await vite.close()
}
