// Requires the admin dev server and the repository's web-react Playwright dependency.
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../../web-react/package.json', import.meta.url))
const { chromium, expect } = require('@playwright/test')
const base = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3202/admin'
const output = mkdtempSync(join(tmpdir(), 'admin-operations-qa-'))
const at = new Date().toISOString()
const zero = { inputTokens: 1000, outputTokens: 200, reasoningTokens: 0, totalTokens: 1200, requestCount: 60, settledCents: 1800 }
const period = { settledCents: 1800, imageCount: 320, text: zero, image: { requestCount: 240, imageCount: 320, settledCents: 1200 } }
const profit = { revenueCents: 2400, upstreamCostCents: 1200, grossProfitCents: 1200, succeededUnits: 300, failedUnits: 4 }
const system = { sampledAt: at, process: { goVersion: 'go1.24', uptimeSeconds: 4000, cpuUsagePercent: 12, logicalCPUs: 4, goMaxProcs: 4, goroutines: 60, memory: { usedBytes: 400000000, limitBytes: 4000000000, heapAllocBytes: 200000000, heapInUseBytes: 250000000, heapObjects: 10000, stackInUseBytes: 10000000, nextGCBytes: 500000000, gcCycles: 12, gcPauseTotalMs: 2, gcCPUFraction: .02 } }, http: { inFlight: 2, total: 2000, windowSeconds: 60, requests: 600, requestsPerSecond: 10, status2xx: 595, status4xx: 3, status5xx: 2, averageLatencyMs: 120, p95LatencyMs: 650, maximumLatencyMs: 2000 }, database: { maxConnections: 30, totalConnections: 10, acquiredConnections: 5, idleConnections: 5, constructingConnections: 0, utilizationPercent: 17, acquireCount: 200, emptyAcquireCount: 0, canceledAcquireCount: 0, acquireDurationMs: 1 }, queue: { available: true, paused: false, latencyMs: 10, memoryBytes: 1000, size: 3, pending: 2, active: 1, scheduled: 0, retry: 0, archived: 0, processedToday: 500, failedToday: 3, onlineWorkers: 2, workerConcurrency: 16, activeWorkers: 1, workers: [] }, taskPressure: { queued: 2, running: 1, active: 3, globalLimit: 1000, userConcurrencyLimit: 4, globalConcurrencyLimit: 32, workerConcurrencyCeiling: 16, effectiveGlobalConcurrency: 32, utilizationPercent: .3, oldestQueuedSeconds: 4 }, providers: [], imageFetch: { available: true, active: 1, effectiveLimit: 8, configuredCeiling: 8, workers: 2, activeUsers: 1, waitingUsers: 0, forecastWindowSeconds: 10, forecastImageUnits: 3, forecastCapacity: 8, forecastPressure: false }, profiling: { enabled: false } }
const logSummary = { count: 102, errorCount: 2, warningCount: 5, slowCount: 3, averageDurationMs: 160, p95DurationMs: 700, distinctTasks: 30, distinctRequests: 70 }
const stats = { totalUsers: 5080, newUsersToday: 36, creditTotals: { incomeCents: 3456789, consumedCents: 2345678, remainingCents: 1111111, frozenCents: 4000, refundCents: 6000 }, usageMetrics: { today: period, last7Days: period, last30Days: period, todayToken: zero }, profitability: { today: profit, last7Days: profit, last30Days: profit }, taskPerformance: { queuedNow: 12, runningNow: 20, created: 600, succeeded: 560, failed: 10, canceled: 5, avgQueueMs: 1500, p95QueueMs: 3000, avgRunMs: 40000, p95RunMs: 80000, avgEndToEndMs: 45000, p95EndToEndMs: 90000 }, taskDaily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${16+i}`, total: 120+i*5, succeeded: 110+i*5, failed: 4 })), typeDistribution: { t2i: 600, assistant: 400 }, providerPerformance: [], operationalIncidents: [], quality: { agent: { traceCount: 40, succeeded: 38, failed: 2, averageScore: 94, failedSteps: 2, unfinishedSteps: 1 }, billing: { anomalousEntries: 2 }, openApi: { enabled: true, activeKeys: 18, requests24Hours: 300, pendingWebhooks: 0, deadWebhooks: 0 }, objectCleanup: { pending: 2, failed: 0 } } }
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  await page.addInitScript(() => localStorage.setItem('admin-theme', 'dark'))
  const errors = [], calls = []
  let failPath = ''
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/**', async route => {
    const u = new URL(route.request().url()), path = u.pathname
    if (failPath && path.endsWith(failPath)) return route.fulfill({ status: 503, json: { success: false, error: '模拟接口暂时不可用' } })
    calls.push({ path, query: Object.fromEntries(u.searchParams), method: route.request().method() })
    let data = { items: [], total: 0 }
    if (path.endsWith('/auth/session')) data = { admin: { role: 'admin', email: 'qa@example.test' } }
    else if (path.endsWith('/system/metrics')) data = system
    else if (path.endsWith('/statistics')) data = stats
    else if (path.endsWith('/orders')) {
      const start = Number(u.searchParams.get('cursor') || 0), limit = 20
      data = { total: 65, nextCursor: start + limit < 65 ? String(start + limit) : null, items: Array.from({ length: Math.min(limit, 65-start) }, (_, i) => ({ id: `order-${start+i}`, userEmail: `buyer-${i}@example.test`, planName: '标准订阅', status: 'completed', amountCents: 3900, providerPayAmountCents: 3900, createdAt: at, finance: { receivedCents: 3900 } })), summary: { total: 65, receivedCents: 253500, refundedCents: 3900, netCents: 249600, confirmedOrders: 65, pendingOrders: 0 } }
    } else if (path.endsWith('/payment-reconciliations/run')) { const body = route.request().postDataJSON(); data = body?.resolution === 'check' ? { checked: 1, outcomes: { matched: 1 }, result: { id: 999, orderId: body.orderId, outcome: 'matched', detail: '该单核对通过', checkedAt: at } } : { checked: 4, outcomes: { matched: 2, repaired: 1, provider_error: 1 } } }
    else if (path.endsWith('/payment-reconciliations')) { const n = Number(u.searchParams.get('page') || 1); data = { items: Array.from({ length: 20 }, (_, i) => ({ id: (n-1)*20+i, orderId: `order-${(n-1)*20+i}`, outcome: i%2 ? 'matched' : 'provider_error', detail: '渠道暂时未响应，需要重试核查', checkedAt: at, expectedAmountCents: 3900, providerPaidAmountCents: 3900 })), total: 45, recoverySupported: true } }
    else if (path.endsWith('/subscription-changes')) { const n = Number(u.searchParams.get('page') || 1); data = { items: Array.from({ length: 25 }, (_, i) => ({ id: `change-${(n-1)*25+i}`, kind: 'refund', status: 'reviewing', userEmail: 'buyer@example.test', createdAt: at, amountCents: 3900 })), total: 60 } }
    else if (path.endsWith('/profitability')) data = { summary: profit, items: Array.from({ length: 30 }, (_, i) => ({ key: `m${i}`, label: `模型 ${i}`, units: 10, ...profit })) }
    else if (path.endsWith('/security/risks')) data = { items: [{ id: 1, severity: 'high', category: 'login', clientIp: '192.0.2.44', score: 80, action: 'block', reason: '短时间重复失败登录', metadata: { evidence: 'sample' }, createdAt: at }], activeBlocks: [{ id: 'block-1', subjectType: 'ip', subjectValue: '192.0.2.44', scope: 'login', reason: '重复登录失败', expiresAt: at }] }
    else if (path.endsWith('/security/upload-hashes')) data = { items: [] }
    else if (path.endsWith('/platform-logs/stats')) data = { config: { enabled: true, securityEnabled: true, operationsEnabled: true, userEnabled: false, retentionDays: 7, maxMb: 256 }, capacity: { count: 102, logicalBytes: 30000, physicalBytes: 40000, byCategory: { operations: 100, security: 2 }, byLevel: { error: 2, info: 100 } }, maxBytes: 256000000, usagePercent: .1, overview: { summary: logSummary, trend: [], topEvents: [], slowRoutes: [], taskIssues: [] } }
    else if (path.endsWith('/platform-logs')) data = { items: [{ id: u.searchParams.get('cursor') ? 1 : 2, category: 'operations', level: 'error', service: 'worker', event: 'upstream_failed', message: 'person@example.test Bearer secret', userId: 'u1', clientIp: '192.168.1.2', metadata: { apiKey: 'secret', status: 502 }, createdAt: at, sizeBytes: 120 }], hasMore: !u.searchParams.get('cursor'), nextCursor: u.searchParams.get('cursor') ? '' : '1' }
    else if (path.endsWith('/model-config')) data = { models: [], providers: [] }
    else if (path.endsWith('/agent-quality')) data = { days: 7, workspace: 'assistant', traceTotal: 120, page: Number(u.searchParams.get('page') || 1), summary: { totalTraces: 120, succeededTraces: 115, failedTraces: 2, canceledTraces: 1, runningTraces: 2, averageScore: 90, averageDurationMs: 15000, toolSteps: 80, failedSteps: 2, unfinishedSteps: 1, confirmedSteps: 77 }, versions: [], traces: [], evalCases: [], evalRuns: [] }
    else if (path.endsWith('/tasks')) { const cursor = u.searchParams.get('cursor'); data = { items: [{ id: cursor ? 't2' : 't1', type: 't2i', status: 'succeeded', prompt: 'test', count: 1, costCents: 1, createdAt: at, params: {}, inputKeys: [], outputKeys: [] }], nextCursor: cursor ? null : 'next', billing: {}, ...(u.searchParams.get('summary') !== 'false' ? { summary: { total: 2, queued: 0, running: 0, succeeded: 2, failed: 0, canceled: 0, today: 2 } } : {}) } }
    else if (path.endsWith('/user-analytics')) data = { summary: { totalUsers: 5080, profilesReady: 4890, newUsers30: 600, activeUsers7: 1800, activeUsers30: 3000, atRiskUsers: 120, highValueUsers: 420, returnedUsers: 200, frequentFailures: 24 }, distributions: { lifecycle: [{ key: 'active', count: 3000 }, { key: 'new', count: 600 }, { key: 'dormant', count: 1160 }, { key: 'churn_risk', count: 120 }, { key: 'returned', count: 200 }], risk: [{ key: 'low', count: 4900 }, { key: 'medium', count: 140 }, { key: 'high', count: 40 }], value: [{ key: 'high', count: 420 }, { key: 'standard', count: 3800 }, { key: 'none', count: 860 }] }, dailyTrend: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i+1).padStart(2,'0')}`, newUsers: 12+i, activeUsers: 130+i*3+(i%5)*20, submittingUsers: 90+i*2, successfulUsers: 80+i*2 })), retention: Array.from({ length: 8 }, (_, i) => ({ week: `2026-W${30+i}`, users: 100, day1Base: 100, day1: 62, day7Base: 100, day7: 40, day30Base: i>4 ? 0 : 100, day30: i>4 ? 0 : 22 })), funnel: { trackingSince: at, features: Array.from({ length: 12 }, (_, i) => ({ feature: `业务 ${i}`, visitors: 500, submittingUsers: 300, successfulUsers: 280, submissions: 700, succeeded: 660, opens: 1000 })) }, calculatedAt: at }
    return route.fulfill({ json: { success: true, data } })
  })
  const visit = async path => { await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' }); await page.screenshot({ path: join(output, `${path || 'dashboard'}.png`) }) }
  await visit('')
  await expect(page.getByText('今日创作差额', { exact: true })).toBeVisible()
  await expect(page.locator('.dashboard-detail-grid')).toBeVisible()
  await visit('finance-center')
  await expect(page.locator('.finance-kpis article').first()).toContainText('65')
  await expect(page.locator('.finance-center')).toHaveCSS('overflow-y', 'auto')
  await page.getByRole('tab', { name: /订单与收款/ }).click()
  await page.locator('.finance-pagination .el-pager li').filter({ hasText: /^2$/ }).click()
  await expect(page.locator('.finance-table')).toContainText('order-20')
  await page.getByRole('tab', { name: /对账与异常/ }).click()
  await page.locator('.finance-pagination .el-pager li').filter({ hasText: /^2$/ }).click()
  await expect(page.locator('.finance-table')).toContainText('order-20')
  await page.getByRole('button', { name: '立即核对', exact: true }).click()
  await page.getByRole('button', { name: '开始核对', exact: true }).click()
  await expect(page.getByText(/核对完成.*检查 4 笔/)).toBeVisible()
  assert.ok(calls.some(c => c.path.endsWith('/orders') && c.query.createdFrom))
  await page.screenshot({ path: join(output, 'finance-reconcile.png') })
  await page.getByRole('button', { name: '核对该单', exact: true }).first().click()
  await expect(page.getByText(/订单 order-0：金额一致。该单核对通过/)).toBeVisible()
  await visit('platform-logs')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 AI 诊断包' }).click()
  const download = await downloadPromise, exported = readFileSync(await download.path(), 'utf8')
  assert.equal(JSON.parse(exported).count, 2)
  assert.ok(!exported.includes('person@example.test') && !exported.includes('Bearer secret') && !exported.includes('192.168.1.2'))
  await visit('security-center')
  await expect(page.getByText('短时间重复失败登录', { exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '核查处理', exact: true }).click()
  await expect(page.getByRole('button', { name: '解除此限制', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看关联日志', exact: true }).click()
  await expect.poll(() => calls.filter(c=>c.path.endsWith('/platform-logs')).at(-1)?.query.category).toBe('security')
  await expect.poll(() => calls.filter(c=>c.path.endsWith('/platform-logs')).at(-1)?.query.ip).toBe('192.0.2.44')
  await visit('agent-quality')
  await page.getByRole('button', { name: /检查 2 次失败执行/ }).click()
  await expect.poll(() => calls.filter(c=>c.path.endsWith('/agent-quality')).at(-1)?.query.status).toBe('failed')
  await page.locator('.aq-toolbar .el-checkbox').click()
  await expect.poll(() => calls.filter(c=>c.path.endsWith('/agent-quality')).at(-1)?.query.issues).toBe('true')
  await page.locator('.aq-page .cursor-pager .el-pager li').filter({ hasText: /^2$/ }).click()
  await expect.poll(() => calls.filter(c=>c.path.endsWith('/agent-quality')).at(-1)?.query.page).toBe('2')
  await visit('tasks')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect.poll(() => calls.filter(c=>c.path.endsWith('/tasks')).at(-1)?.query.summary).toBe('false')
  await page.locator('.refresh-now-button').click()
  await expect.poll(() => calls.filter(c=>c.path.endsWith('/tasks')).at(-1)?.query.summary).toBe('true')
  await visit('user-profile-dashboard')
  await expect(page.locator('.feature-table tbody tr')).toHaveCount(12)
  await page.getByRole('button', { name: '全屏', exact: true }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await page.screenshot({ path: join(output, 'profile-fullscreen.png') })
  await page.getByRole('button', { name: '退出全屏', exact: true }).click()
  await page.locator('.feature-table tbody tr').last().scrollIntoViewIfNeeded()
  await expect(page.locator('.feature-table tbody tr').last()).toBeInViewport()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'profile-mobile.png') })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.setViewportSize({ width: 1600, height: 1000 })
  failPath = '/statistics'
  await visit('')
  await expect(page.getByText('业务统计读取失败，当前数字可能是上次快照，请刷新后再判断。')).toBeVisible()
  failPath = '/security/risks'
  await visit('security-center')
  await expect(page.getByText('安全数据读取失败，不能据此判断当前没有风险。')).toBeVisible()
  failPath = '/agent-quality'
  await visit('agent-quality')
  await expect(page.getByText('数据读取失败，不能据此认定没有失败或质量良好。')).toBeVisible()
  failPath = ''
  assert.deepEqual(errors, [])
  console.log(`PASS: all seven workspaces; financial pagination/reconciliation, anonymized export, actionable guidance, summary reuse, fullscreen and mobile. Screenshots: ${output}`)
} finally { await browser.close() }
