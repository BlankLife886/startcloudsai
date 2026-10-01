import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { fetchRuntimeConfig } from '../../legacy-modules/services/runtimeConfig.js';
import { cancelTask, createTask, getTask, listTasks, quoteTaskPrice, uploadFile, waitForTask } from '../../legacy-modules/services/tasksApi.js';
import { fetchAuthenticatedMediaBlob } from '../../legacy-modules/services/authenticatedMedia.js';
import { taskOriginalUrl } from '../../legacy-modules/features/creator-hub/taskMedia.js';
import { buildSubjectRequest, describeHoloGenerationError, HOLO_SOURCE, image2Models, isHoloSubjectTask, privateFileUrl, requestSubjectQuote } from './holoCard.js';
import { readCardImage } from './holoCardImages.js';

const terminal = new Set(['succeeded', 'failed', 'canceled']);
const SOURCE_RECOVERY_TIMEOUT_MS = 8000;
const SOURCE_RECOVERY_WARNING = '原图暂时无法恢复，仍可检查并采用透明主体。';

async function recoverTaskSource(record, signal) {
  const sourceUrl = privateFileUrl(record.params?.sourceUrl);
  if (!sourceUrl || signal.aborted) return { source: null, warning: SOURCE_RECOVERY_WARNING };
  const controller = new AbortController();
  let stop;
  const stopped = new Promise(resolve => {
    stop = () => { controller.abort(); resolve(null); };
  });
  signal.addEventListener('abort', stop, { once: true });
  const timeout = setTimeout(stop, SOURCE_RECOVERY_TIMEOUT_MS);
  try {
    // Source recovery runs beside task polling and never delays a valid result indefinitely.
    const source = await Promise.race([stopped, (async () => {
      const blob = await fetchAuthenticatedMediaBlob(sourceUrl, { signal: controller.signal });
      const dimensions = await readCardImage(blob);
      if (controller.signal.aborted) return null;
      return { blob, dimensions, name: String(record.params?.sourceName || '原始图片').slice(0, 256) };
    })()]);
    return { source, warning: source ? '' : SOURCE_RECOVERY_WARNING };
  } catch {
    return { source: null, warning: SOURCE_RECOVERY_WARNING };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', stop);
    controller.abort();
  }
}

export function useHoloCardJob({ userId, onCandidate }) {
  const [search, setSearch] = useSearchParams();
  const taskId = search.get('task') || '';
  const [models, setModels] = useState([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [error, setErrorMessage] = useState('');
  const [errorDetail, setErrorDetail] = useState(null);
  const [sourceWarning, setSourceWarning] = useState('');
  const [recoveredSource, setRecoveredSource] = useState(null);
  const [phase, setPhase] = useState('');
  const [task, setTask] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(Boolean(userId));
  const [confirmation, setConfirmation] = useState(null);
  const [configSyncToken, setConfigSyncToken] = useState(0);
  const [historySyncToken, setHistorySyncToken] = useState(0);
  const [taskSyncToken, setTaskSyncToken] = useState(0);
  const draftRef = useRef(null);
  const controllerRef = useRef(null);
  const taskControllerRef = useRef(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ onCandidate });
  callbacks.current = { onCandidate };
  const busy = Boolean(phase) || Boolean(taskId && task && !terminal.has(task.status));

  function setError(value, fallback) {
    const description = value ? describeHoloGenerationError(value, fallback) : null;
    setErrorMessage(description?.message || '');
    setErrorDetail(description?.errorDetail || null);
  }

  useEffect(() => {
    mounted.current = true;
    setConfirmation(null);
    setHistory([]);
    setRecoveredSource(null);
    return () => {
      mounted.current = false;
      controllerRef.current?.abort();
      taskControllerRef.current?.abort();
      lock.current = false;
      draftRef.current = null;
    };
  }, [userId]);

  useEffect(() => {
    let active = true;
    setConfigLoading(true);
    setConfigError('');
    fetchRuntimeConfig({ force: configSyncToken > 0 }).then(config => { if (active) setModels(image2Models(config)); })
      .catch(e => { if (active) setConfigError(e.message || '模型配置读取失败'); })
      .finally(() => { if (active) setConfigLoading(false); });
    return () => { active = false; };
  }, [configSyncToken]);

  useEffect(() => {
    setHistoryError('');
    if (!userId) {
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    const controller = new AbortController();
    setHistoryLoading(true);
    listTasks({ type: 't2i', source: HOLO_SOURCE, limit: 16, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setHistory(result.items.filter(isHoloSubjectTask)); })
      .catch(e => { if (!controller.signal.aborted) setHistoryError(e.message || '主体记录读取失败'); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [userId, task?.id, task?.status, historySyncToken]);

  useEffect(() => {
    if (!taskId || !userId) {
      lock.current = false;
      setPhase('');
      setTask(null);
      setSourceWarning('');
      setRecoveredSource(null);
      return;
    }
    const controller = new AbortController();
    const signal = controller.signal;
    lock.current = false;
    taskControllerRef.current = controller;
    setTask(null);
    setPhase('正在同步');
    setError('');
    setSourceWarning('');
    setRecoveredSource(null);
    async function recover() {
      let record = await getTask(taskId, { signal });
      if (signal.aborted) return;
      if (!isHoloSubjectTask(record)) throw new Error('该记录不是闪卡主体任务');
      setTask(record);
      const sourceResult = recoverTaskSource(record, signal);
      if (!terminal.has(record.status)) {
        setPhase('');
        record = await waitForTask(taskId, { signal, onUpdate: next => {
          if (!signal.aborted) setTask(next);
        } });
      }
      if (signal.aborted) return;
      setTask(record);
      if (record.status === 'canceled') return;
      if (record.status !== 'succeeded') {
        const failure = Object.assign(new Error(record.errorMessage || '主体生成失败'), {
          code: record.errorCode || '', taskId: record.id, modelId: record.params?.publicModelKey || '',
        });
        if (record.status !== 'failed') throw failure;
        // A failed job can still recover its reference for an original-image
        // card. Successful subjects retain the existing review-before-adoption flow.
        setError(failure);
        setConfirmation(null);
        setPhase('正在恢复原图');
        const { source, warning } = await sourceResult;
        if (signal.aborted) return;
        setRecoveredSource(source);
        setSourceWarning(warning);
        return;
      }
      setPhase('正在校验透明通道');
      const url = privateFileUrl(taskOriginalUrl(record));
      if (!url) throw new Error('任务未返回站内原始 PNG');
      const blob = await fetchAuthenticatedMediaBlob(url, { signal });
      const stats = await readCardImage(blob, { strictAlpha: true });
      if (signal.aborted) return;
      const { source, warning } = await sourceResult;
      if (signal.aborted) return;
      setSourceWarning(warning);
      callbacks.current.onCandidate({ blob, stats, name: 'image2-subject.png', taskId: record.id, source, sourceWarning: warning });
    }
    recover().catch(e => {
      if (!signal.aborted) {
        setError(e, '任务同步失败');
        setConfirmation(null);
      }
    }).finally(() => {
      if (!signal.aborted) setPhase('');
      controller.abort();
      if (taskControllerRef.current === controller) taskControllerRef.current = null;
    });
    return () => controller.abort();
  }, [taskId, userId, taskSyncToken]);

  async function prepare({ source, model, resolution, instructions }) {
    if (!userId || !source?.blob || lock.current || busy || confirmation) return;
    lock.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError('');
    setPhase('读取报价');
    try {
      const request = buildSubjectRequest(model, resolution, source.dimensions, instructions);
      const signature = JSON.stringify(request);
      let draft = draftRef.current;
      if (!draft || draft.blob !== source.blob || draft.signature !== signature) {
        draft = { blob: source.blob, signature, idempotencyKey: crypto.randomUUID() };
        draftRef.current = draft;
      }
      // Quote first; no user image is sent to storage or the model before confirmation.
      const quote = await requestSubjectQuote(request, quoteTaskPrice, { signal: controller.signal });
      if (controller.signal.aborted || !mounted.current) return;
      if (!Number.isFinite(quote.unitPriceCents) || !Number.isFinite(quote.totalPriceCents)) throw new Error('未取得有效报价，暂不提交');
      draft.request = request;
      draft.sourceName = source.name;
      draft.quote = quote;
      setConfirmation({ kind: 'generate', total: quote.totalPriceCents });
    } catch (e) {
      if (!controller.signal.aborted && mounted.current) setError(e, '报价读取失败，请稍后重试');
    } finally {
      if (controllerRef.current === controller) {
        lock.current = false;
        if (!controller.signal.aborted && mounted.current) setPhase('');
        controllerRef.current = null;
      }
    }
  }

  async function confirm() {
    if (!userId || lock.current || !confirmation) return;
    lock.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError('');
    try {
      if (confirmation.kind === 'cancel') {
        setPhase('正在停止');
        const next = await cancelTask(taskId, { acknowledgeUpstream: true });
        if (!mounted.current || controller.signal.aborted) return;
        setTask(next);
        taskControllerRef.current?.abort();
        setTaskSyncToken(value => value + 1);
      } else {
        const draft = draftRef.current;
        if (!draft?.request) throw new Error('提交参数已失效，请重新读取报价');
        if (!draft.upload) {
          setPhase('上传原图');
          const file = new File([draft.blob], draft.sourceName, { type: draft.blob.type });
          draft.upload = await uploadFile(file, { signal: controller.signal });
        }
        if (!mounted.current || controller.signal.aborted) return;
        if (!draft.upload?.key || !privateFileUrl(draft.upload.url)) throw new Error('上传未返回有效站内文件');
        setPhase('提交任务');
        const next = await createTask({ ...draft.request,
          params: { ...draft.request.params, sourceUrl: draft.upload.url, sourceName: draft.sourceName },
          inputKeys: [draft.upload.key], expectedUnitPriceCents: draft.quote.unitPriceCents,
          idempotencyKey: draft.idempotencyKey,
        });
        if (!mounted.current || controller.signal.aborted) return;
        setTask(next);
        setSearch({ task: next.id }, { replace: true });
        draftRef.current = null;
      }
      setConfirmation(null);
    } catch (e) {
      if (mounted.current && !controller.signal.aborted) {
        setError(e, '提交失败，请稍后重试');
        setConfirmation(null);
      }
    } finally {
      if (controllerRef.current === controller) {
        lock.current = false;
        if (mounted.current && !controller.signal.aborted) setPhase('');
      }
    }
  }

  function clear() {
    controllerRef.current?.abort();
    taskControllerRef.current?.abort();
    controllerRef.current = null;
    taskControllerRef.current = null;
    lock.current = false;
    draftRef.current = null;
    setPhase('');
    setTask(null);
    setSearch({}, { replace: true });
    setConfirmation(null);
    setError('');
    setSourceWarning('');
    setRecoveredSource(null);
  }

  function retryTask() {
    if (!taskId || !userId || lock.current || confirmation || phase) return;
    taskControllerRef.current?.abort();
    setTaskSyncToken(value => value + 1);
  }

  function openHistory(id) {
    if (!id || busy || lock.current || confirmation) return;
    taskControllerRef.current?.abort();
    setTask(null);
    setSearch({ task: id }, { replace: true });
    if (id === taskId) setTaskSyncToken(value => value + 1);
  }

  return {
    models, configLoading, configError, error, errorDetail, setError, sourceWarning, recoveredSource, task, taskId,
    history, historyError, historyLoading, phase, busy, confirmation,
    prepare, confirm, clear, dismiss: () => { if (!phase) setConfirmation(null); },
    requestCancel: () => { if (taskId && task && !terminal.has(task.status) && !phase && !lock.current) setConfirmation({ kind: 'cancel' }); },
    refreshConfig: () => setConfigSyncToken(value => value + 1),
    refreshHistory: () => setHistorySyncToken(value => value + 1),
    retryTask, resync: retryTask, openHistory,
  };
}
