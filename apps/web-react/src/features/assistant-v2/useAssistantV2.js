import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../../auth/AuthContext.jsx'
import { useAuthPrompt } from '../../auth/AuthPromptContext.jsx'
import notificationService from '@react/legacy-modules/services/notification.js'
import { updateProfile } from '@react/legacy-modules/services/meApi.js'
import { scheduleWalletRefresh } from '@react/legacy-modules/services/walletSync.js'
import {
  MAX_ASSISTANT_MESSAGE_CHARACTERS,
  assistantReasoningPrice,
  defaultReasoningEffort,
  normalizeConfig,
} from '../assistant/assistantWorkspaceCore.jsx'
import { createRunSync } from './domain/runSync.js'
import {
  activeRunFor,
  conversationHasWork,
  initialState,
  newId,
  queuedRunsFor,
  reducer,
  titleFromPrompt,
} from './domain/v2State.js'
import { v2Api } from './services/v2Api.js'

const THREAD_PAGE_SIZE = 60

export function useAssistantV2() {
  const auth = useAuth()
  const { requestAuth } = useAuthPrompt()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, dispatch] = useReducer(reducer, initialState)
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [serviceError, setServiceError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [costPrompt, setCostPrompt] = useState(null)
  const [stopping, setStopping] = useState(false)
  const syncRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const mountedRef = useRef(true)
  const userId = auth.user?.id || ''

  if (!syncRef.current) {
    syncRef.current = createRunSync({ api: v2Api, dispatch: (action) => mountedRef.current && dispatch(action) })
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      syncRef.current?.dispose()
    }
  }, [])

  const model = useMemo(() => config?.conversationModels?.[0] || null, [config])
  const reasoningEffort = useMemo(() => defaultReasoningEffort(model), [model])
  const turnPrice = useMemo(() => (model ? assistantReasoningPrice(model, reasoningEffort).effective : 0), [model, reasoningEffort])

  const reconcileRuns = useCallback(async () => {
    if (!userId) return
    try {
      const runs = await v2Api.listActiveRuns()
      if (!mountedRef.current) return
      dispatch({ type: 'runs/reconciled', runs })
      for (const run of runs) syncRef.current.track(run)
    } catch {
      // The next focus or online event retries; tracked runs keep polling.
    }
  }, [userId])

  const loadThread = useCallback(async (conversationId) => {
    if (!conversationId) return
    try {
      const data = await v2Api.getConversation(conversationId, { messageLimit: THREAD_PAGE_SIZE })
      if (!mountedRef.current) return
      dispatch({
        type: 'thread/loaded',
        conversationId,
        messages: Array.isArray(data?.messages) ? data.messages : [],
        hasMore: data?.hasMoreMessages,
      })
    } catch (error) {
      if (error?.name !== 'AbortError') notificationService.error(error?.message || '对话加载失败')
    }
  }, [])

  // Initial load: config for everyone, conversations and runs when signed in.
  useEffect(() => {
    let canceled = false
    setLoading(true)
    setServiceError('')
    ;(async () => {
      try {
        const [rawConfig, conversations] = await Promise.all([
          v2Api.fetchConfig(),
          userId ? v2Api.listConversations() : Promise.resolve([]),
        ])
        if (canceled) return
        setConfig(normalizeConfig(rawConfig))
        dispatch({ type: 'conversations/loaded', conversations })
        const requested = new URLSearchParams(window.location.search).get('c') || ''
        if (requested && conversations.some((item) => item.id === requested)) {
          dispatch({ type: 'conversations/activated', id: requested })
        }
        await reconcileRuns()
      } catch (error) {
        if (!canceled) setServiceError(error?.message || 'AI 服务暂不可用')
      } finally {
        if (!canceled) setLoading(false)
      }
    })()
    return () => { canceled = true }
  }, [reconcileRuns, userId])

  // Always fetch the active conversation fresh, so a turn that finished in
  // another tab or device is never shown stale.
  useEffect(() => {
    if (state.activeId) void loadThread(state.activeId)
  }, [loadThread, state.activeId])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      syncRef.current.refreshAll()
      void reconcileRuns()
      if (stateRef.current.activeId) void loadThread(stateRef.current.activeId)
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadThread, reconcileRuns])

  const selectConversation = useCallback((id) => {
    dispatch({ type: 'conversations/activated', id })
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      if (id) next.set('c', id)
      else next.delete('c')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const confirmCost = useCallback(() => {
    if (!turnPrice || auth.user?.requireCostConfirm === false) return Promise.resolve(true)
    return new Promise((resolve) => setCostPrompt({ price: turnPrice, model: model?.label || '', resolve }))
  }, [auth.user?.requireCostConfirm, model?.label, turnPrice])

  const answerCost = useCallback(async (accepted, { remember = false } = {}) => {
    const prompt = costPrompt
    setCostPrompt(null)
    if (accepted && remember) {
      try {
        const result = await updateProfile({ requireCostConfirm: false })
        auth.setUser({ ...auth.user, ...(result?.user || { requireCostConfirm: false }) })
      } catch {
        // The turn proceeds even if the preference could not be saved.
      }
    }
    prompt?.resolve(accepted)
  }, [auth, costPrompt])

  const send = useCallback(async (text = draft) => {
    const prompt = String(text || '').trim()
    if (!prompt || sending) return
    if (requestAuth({ featureLabel: 'AI 助手' })) return
    if ([...prompt].length > MAX_ASSISTANT_MESSAGE_CHARACTERS) {
      notificationService.warning(`消息不能超过 ${MAX_ASSISTANT_MESSAGE_CHARACTERS.toLocaleString('zh-CN')} 个字符`)
      return
    }
    if (!model) {
      notificationService.error('AI 助手暂时没有可用的模型')
      return
    }
    setSending(true)
    try {
      if (!(await confirmCost())) return
      let conversationId = stateRef.current.activeId
      if (!conversationId) {
        const conversation = await v2Api.createConversation()
        conversationId = conversation.id
        dispatch({ type: 'conversations/added', conversation })
        selectConversation(conversationId)
      }
      const userMessageId = newId()
      const assistantMessageId = newId()
      const firstTurn = !(stateRef.current.threads[conversationId]?.messages || []).length
      dispatch({
        type: 'turn/started',
        conversationId,
        userMessageId,
        assistantMessageId,
        prompt,
        title: firstTurn ? titleFromPrompt(prompt) : '',
      })
      setDraft('')
      try {
        const created = await v2Api.createRun({
          conversationId, prompt, userMessageId, assistantMessageId,
          model: model.model, reasoningEffort,
        })
        dispatch({ type: 'run/updated', run: created.run, assistantMessage: created.assistantMessage, userMessage: created.userMessage })
        syncRef.current.track(created.run)
        scheduleWalletRefresh()
        if (firstTurn) {
          dispatch({ type: 'conversations/renamed', id: conversationId, title: titleFromPrompt(prompt) })
          void v2Api.renameConversation(conversationId, titleFromPrompt(prompt)).catch(() => undefined)
        }
      } catch (error) {
        // Nothing was created: put the draft back so the user loses nothing.
        dispatch({ type: 'turn/rejected', conversationId, userMessageId, assistantMessageId })
        setDraft((current) => current || prompt)
        notificationService.error(error?.message || '发送失败，请稍后重试')
      }
    } catch (error) {
      notificationService.error(error?.message || '新建对话失败')
    } finally {
      if (mountedRef.current) setSending(false)
    }
  }, [confirmCost, draft, model, reasoningEffort, requestAuth, selectConversation, sending])

  const stop = useCallback(async () => {
    const run = activeRunFor(stateRef.current, stateRef.current.activeId)
      || queuedRunsFor(stateRef.current, stateRef.current.activeId)[0]
    if (!run || stopping) return
    setStopping(true)
    try {
      let result
      try {
        result = await v2Api.cancelRun(run.id, run.cancelPolicy?.upstreamSubmitted === true)
      } catch (error) {
        if (error?.code !== 'assistant_cancel_confirmation_required') throw error
        result = await v2Api.cancelRun(run.id, true)
      }
      syncRef.current.untrack(run.id)
      if (result?.canceled) {
        dispatch({ type: 'run/stopped', runId: run.id, conversationId: run.conversationId, assistantMessageId: run.assistantMessageId })
        scheduleWalletRefresh()
      } else {
        await loadThread(run.conversationId)
        await reconcileRuns()
      }
    } catch (error) {
      notificationService.error(error?.message || '停止失败，请稍后重试')
    } finally {
      if (mountedRef.current) setStopping(false)
    }
  }, [loadThread, reconcileRuns, stopping])

  const deleteConversation = useCallback(async (id) => {
    try {
      await v2Api.deleteConversation(id, conversationHasWork(stateRef.current, id))
      for (const run of Object.values(stateRef.current.runs)) {
        if (run.conversationId === id) syncRef.current.untrack(run.id)
      }
      dispatch({ type: 'conversations/removed', id })
      if (stateRef.current.activeId === id) selectConversation('')
    } catch (error) {
      notificationService.error(error?.message || '删除对话失败')
    }
  }, [selectConversation])

  const loadEarlier = useCallback(async () => {
    const id = stateRef.current.activeId
    const thread = stateRef.current.threads[id]
    const first = thread?.messages?.find((message) => !message.local)
    if (!id || !thread?.hasMore || !first) return
    try {
      const data = await v2Api.getConversation(id, { beforeMessageId: first.id, messageLimit: THREAD_PAGE_SIZE })
      dispatch({ type: 'thread/prepended', conversationId: id, messages: data?.messages || [], hasMore: data?.hasMoreMessages })
    } catch (error) {
      notificationService.error(error?.message || '更早对话加载失败')
    }
  }, [])

  const activeId = state.activeId
  const thread = state.threads[activeId] || { messages: [], hasMore: false, loaded: !activeId }
  const running = activeRunFor(state, activeId)
  const queued = queuedRunsFor(state, activeId)

  return {
    auth,
    loading,
    serviceError,
    conversations: state.conversations,
    activeId,
    thread,
    running,
    queued,
    busy: Boolean(running || queued.length),
    draft,
    setDraft,
    sending,
    stopping,
    turnPrice,
    model,
    costPrompt,
    answerCost,
    send,
    stop,
    selectConversation,
    deleteConversation,
    loadEarlier,
    maxCharacters: MAX_ASSISTANT_MESSAGE_CHARACTERS,
  }
}
