#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const go = (pkg, pattern) => ({ kind: 'go', cwd: 'apps/server', command: 'go', args: ['test', '-json', '-race', '-p', '1', '-parallel', '2', pkg, '-run', pattern, '-count=1', '-timeout=300s'] })
const node = (file, pattern) => ({ kind: 'node', cwd: 'apps/web-react', command: process.execPath, args: ['--test', '--experimental-strip-types', ...(pattern ? [`--test-name-pattern=${pattern}`] : []), file] })
const mobile = (pattern) => ({ kind: 'flutter', cwd: 'apps/mobile', command: process.env.FLUTTER_BIN || 'flutter', args: ['test', '--concurrency=1', '--reporter=json', '--name', pattern, 'test/features/task_lifecycle_test.dart'] })

const chains = [
	{ id: 'E-07', title: '独立Redis实测图片执行池阻塞时聊天仍执行', steps: [go('./internal/taskflow', '^TestExecutionQueues')] },
	{ id: 'E-01', title: '按张计量、对话分池与多Worker并发准入', steps: [go('./internal/worker', '^Test(ExecutionPools|SharedConcurrency|ContractConcurrency)')] },
	{ id: 'E-02', title: '保留上游恢复名额、原线路与执行权守卫', steps: [go('./internal/worker', '^TestExecution(Recovery|ImageAdapter)')] },
	{ id: 'E-03', title: '不可变模型快照、实际HTTP请求与并发绑定', steps: [go('./internal/worker', '^TestExecutionSnapshot')] },
	{ id: 'E-04', title: '创建前容量校验、幂等、编辑、取消和恢复标记过滤', steps: [go('./internal/httpapi', '^TestExecutionAdmission')] },
	{ id: 'E-05', title: '多图真实模拟执行、提交丢失保护和部分退款', steps: [go('./internal/worker', '^Test(ExecuteAssistantC2AMultiImageTracksSlotsWithoutRaces|CRUNPartialSubmissionRetryKeepsKnownJobs|CRUNUnknownSubmissionPollsOnlyKnownJobsAndRefundsRemainder|AssistantImageFailoverRespectsSubmissionSafetyMarkers)$')] },
	{ id: 'E-06', title: '客户端数量限制、任务监测、重试与流式恢复', steps: [node('scripts/test-assistant-image-limits.mjs'), node('scripts/test-task-concurrency.mjs'), node('scripts/test-task-client-lifecycle.mjs'), node('scripts/test-assistant-retry-policy.mjs'), node('scripts/test-assistant-stream-merge.mjs')] },
  { id: 'P1-01', title: '持续5xx/断连及多线路乱序到期终止与退款', steps: [go('./internal/worker', '^Test(ExpiredOpenAITransportErrorsReleaseTask|ExpiredAttemptsRespectNewAttemptAndWorkerOwnership)$')] },
  { id: 'P1-02', title: '同步请求活租约不被后台轮询接管', steps: [go('./internal/worker', '^Test(LiveSubmittingWorkerIsNotClaimedUntilLeaseExpires|SynchronousFallbackIsNotPolledBeforeReturn|AssistantImageFailoverRespectsSubmissionSafetyMarkers)$')] },
  { id: 'P1-03', title: 'CRUN已知任务恢复与未知提交不重发', steps: [go('./internal/worker', '^Test(CRUN(PartialSubmissionRetryKeepsKnownJobs|UnknownSubmissionPollsOnlyKnownJobsAndRefundsRemainder|UnknownFirstSubmissionFailsWithoutRetry|PreflightFailureCanRetryBeforeAnyJobExists)|AssistantImageFailoverRespectsSubmissionSafetyMarkers)$')] },
  { id: 'P1-04', title: '重排任务取消展示与结算均核实上游提交', steps: [
    go('./internal/taskflow', '^Test(QueuedPendingCancellationRequiresConfirmationAndSettles|PreparingCancellationHistoryPreservesRefund)$'),
    go('./internal/httpapi', '^TestQueuedTaskCancelPolicyUsesStoredAttemptsAndMatchesSettlement$'),
  ] },
  { id: 'P1-05', title: '助手历史编辑保留活动run和冻结款', steps: [go('./internal/httpapi', '^TestAssistantQueuedHistoryEditPreservesActiveRunAndReservation$')] },
  { id: 'P1-06', title: '助手完整多图执行无共享map竞态', steps: [go('./internal/worker', '^TestExecuteAssistantC2AMultiImageTracksSlotsWithoutRaces$')] },
  { id: 'P1-07', title: '画布回执丢失后持久幂等与稳定生成身份', steps: [
    node('scripts/test-canvas-agent-delivery.mjs', 'rebuilds delivery|does not replay an uncertain mutation|unavailable durable storage|observing executor'),
    node('scripts/test-task-client-lifecycle.mjs', 'ordinary Agent generation reuses|canvas text retry'),
  ] },
  { id: 'P1-08', title: '手持批次整批回滚、幂等和响应丢失重试', steps: [
    go('./internal/httpapi', '^TestHandheld(Atomic|Idempotency)'), node('scripts/test-handheld-submission.mjs'),
  ] },
  { id: 'P1-09', title: '订阅启动与定时补发幂等', steps: [go('./internal/worker', '^TestSubscription(GrantsHavePeriodicRecovery|StartupAndPeriodicGrantsAreIdempotent)$')] },
  { id: 'P2-01', title: '助手明确终态停止轮询，含糊结果保持原身份', steps: [go('./internal/worker', '^Test(WaitAssistantC2ATaskStopsOnExplicitFailure|SubmitAndWaitAssistantC2ATaskRetriesTerminalSlotWithNewID|SubmitAndWaitAssistantC2ATaskKeepsAmbiguousSlot)$')] },
  { id: 'P2-02', title: 'Agent工具执行后不整轮换路重放', steps: [go('./internal/worker', '^TestAssistantAgentDoesNotFailoverAfterToolExecution$')] },
  { id: 'P2-03', title: '附件读取失败不能作为回答或导出证据', steps: [go('./internal/worker', '^TestAssistantDocumentChat(RejectsFailedReadAsEvidence|ExecutesAttachedFileSearchBeforeAnswering)$')] },
  { id: 'P2-04', title: '移动端解析取消政策并发送明确确认', steps: [mobile('task cancellation|confirming stop')] },
  { id: 'P2-05', title: '客户端不伪造取消/等待超时终态', steps: [
    node('scripts/test-task-client-lifecycle.mjs', 'task watcher|monitor errors'),
    node('scripts/test-task-concurrency.mjs', 'continued task observation'),
  ] },
  { id: 'P2-06', title: '主站与移动端累计全部尝试总耗时', steps: [
    { kind: 'script', cwd: 'apps/web-react', command: process.execPath, args: ['scripts/test-task-generation-timing.mjs'], marker: 'task generation and total duration checks passed' },
    mobile('total task time'),
  ] },
  { id: 'P2-07', title: '画布输入/图版本与服务端恢复一致', steps: [
    node('scripts/test-canvas-workflow.mjs', 'workflow recovery validates|output creation and execution metadata|manually replaced|output fingerprints|legacy completed outputs|local operation output count'),
    go('./internal/httpapi', '^TestCanvasWorkflow(InputSignatureProtectsRecovery|LegacyProgressCannotBeReacquired|OutputFingerprintSurvivesProgress)$'),
  ] },
  { id: 'P2-08', title: '画布重试结果按执行身份映射', steps: [node('scripts/test-canvas-agent-delivery.mjs', 'workflow retry identity')] },
]

const argv = process.argv.slice(2)
const option = (name) => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index + 1] }
const renderCommand = (step) => `${step.command} ${step.args.map(arg => /^[A-Za-z0-9_./:=+-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`).join(' ')}`
if (argv.includes('--list')) {
  for (const chain of chains) {
    console.log(`${chain.id} ${chain.title}`)
    for (const step of chain.steps) console.log(`  [${step.cwd}] ${renderCommand(step)}`)
  }
  process.exit(0)
}
if (argv.includes('--only') && !option('--only')) throw new Error('--only needs an issue ID, e.g. P1-01')
const wanted = option('--only')?.split(',')
if (wanted?.some(id => !chains.some(chain => chain.id === id))) throw new Error('Unknown issue ID; use --list')
const selected = wanted ? chains.filter(chain => wanted.includes(chain.id)) : chains
const database = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/postgres'
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname)) {
  throw new Error('This isolated test runner requires a local TEST_DATABASE_URL')
}
const env = { ...process.env, GOMAXPROCS: '2', GIN_MODE: 'release', TEST_DATABASE_URL: database }
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const directory = join(root, '.artifacts', 'task-chain-tests', stamp)
await mkdir(directory, { recursive: true })

function countTests(kind, output, marker) {
  if (kind === 'script') return output.includes(marker) ? 1 : 0
  if (kind === 'node') return [...output.matchAll(/^# pass (\d+)$/gm)].reduce((sum, match) => sum + Number(match[1]), 0)
  const records = output.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
  if (kind === 'go') return records.filter(event => event.Action === 'pass' && event.Test && !event.Test.includes('/')).length
  const realTests = new Set(records.filter(event => event.type === 'testStart' && !event.test.name.startsWith('loading ')).map(event => event.test.id))
  return records.filter(event => event.type === 'testDone' && realTests.has(event.testID) && event.result === 'success' && !event.skipped).length
}

async function runStep(chain, step, index) {
  console.log(`  ${renderCommand(step)}`)
  const start = Date.now()
  const execution = await new Promise(resolveResult => {
    let output = ''
    let error = ''
    const child = spawn(step.command, step.args, { cwd: join(root, step.cwd), env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { error += data })
    child.on('error', reason => { error += String(reason) })
    child.on('close', (code, signal) => resolveResult({ code, signal, output, error }))
  })
  const count = countTests(step.kind, execution.output, step.marker)
  const passed = execution.code === 0 && count > 0
  const log = `${chain.id}-${index + 1}.log`
  await writeFile(join(directory, log), execution.output + '\nSTDERR:\n' + execution.error)
  const result = { cwd: step.cwd, command: renderCommand(step), passed, testCount: count, exitCode: execution.code, signal: execution.signal, durationMs: Date.now() - start, log }
  console.log(`  ${passed ? 'PASS' : 'FAIL'} · ${count} ${step.kind === 'script' ? 'assertion scripts' : 'tests'} · ${(result.durationMs / 1000).toFixed(1)}s`)
  if (!passed) console.log((execution.error + '\n' + execution.output).split('\n').slice(-20).join('\n'))
  return result
}

const results = []
for (const chain of selected) {
  console.log(`\n${chain.id} ${chain.title}`)
  const steps = []
  for (const [index, step] of chain.steps.entries()) steps.push(await runStep(chain, step, index))
  results.push({ id: chain.id, title: chain.title, passed: steps.every(step => step.passed), steps })
  await writeFile(join(directory, 'results.json'), JSON.stringify({ startedAt: stamp, results }, null, 2) + '\n')
}
const passed = results.filter(result => result.passed).length
const markdown = [
  '# 独立任务链路测试结果', '', `执行时间：${stamp}。通过 ${passed}/${results.length} 项。`,
  '只使用模拟上游和独立临时数据库，不代表真实供应商或生产环境验收。', '',
  '| 编号 | 验证目标 | 结果 |', '|---|---|---|',
  ...results.map(result => `| ${result.id} | ${result.title} | ${result.passed ? 'PASS' : 'FAIL'} |`), '',
  ...results.flatMap(result => [`## ${result.id}`, '', ...result.steps.flatMap(step => [
    `工作目录：${step.cwd}。结果：${step.passed ? 'PASS' : 'FAIL'}，${step.testCount} 项，${(step.durationMs / 1000).toFixed(1)} 秒。`,
    '', '```sh', step.command, '```', '', `[原始输出](${join(directory, step.log)})`, '',
  ])]),
].join('\n')
await writeFile(join(directory, 'results.md'), markdown)
console.log(`\n${passed}/${results.length} chains passed. Report: ${join(directory, 'results.md')}`)
process.exitCode = passed === results.length ? 0 : 1
