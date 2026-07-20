import notificationService from '@/services/notification'
import { defineStore } from 'pinia'
import mqttBrowser from 'mqtt/dist/mqtt.min.js'
import { computed, ref } from 'vue'
import { fetchRealtimeEvents } from '@/services/realtimeEvents'

const MAX_RECENT_MESSAGES = 20
const MAX_SEEN_MESSAGE_IDS = 300
const CATCHUP_INTERVAL_MS = 10_000

export const useMqttStore = defineStore('mqtt', () => {
  const status = ref('idle')
  const error = ref('')
  const connectedAt = ref('')
  const lastMessage = ref(null)
  const recentMessages = ref([])
  const catchupActive = ref(false)
  let client = null
  let activeSignature = ''
  let activeUserId = ''
  let catchupCursor = ''
  let catchupTimer = null
  let catchupRequest = null
  let catchupEnabled = false
  const seenMessageIds = new Set()

  const isConnected = computed(() => status.value === 'connected')

  function start(config = {}, context = {}) {
    const normalized = normalizeConfig(config)
    const nextUserId = String(context.userId || '')
    const signature = JSON.stringify({
      ...normalized,
      userId: nextUserId,
    })
    if (nextUserId !== activeUserId) {
      catchupCursor = ''
      seenMessageIds.clear()
    }
    activeUserId = nextUserId
    startCatchup()
    if (signature === activeSignature && client) return
    stopClient()
    activeSignature = signature

    if (!normalized.enabled || !normalized.brokerUrl) {
      status.value = 'disabled'
      return
    }

    status.value = 'connecting'
    error.value = ''
    const randomId = Math.random().toString(36).slice(2, 10)
    client = mqttBrowser.connect(normalized.brokerUrl, {
      clientId: `${normalized.clientIdPrefix}-${randomId}`,
      clean: true,
      keepalive: normalized.keepalive,
      reconnectPeriod: normalized.reconnectPeriod,
      connectTimeout: 12_000,
      resubscribe: true,
      ...(normalized.username ? { username: normalized.username } : {}),
      ...(normalized.password ? { password: normalized.password } : {}),
    })

    client.on('connect', () => {
      status.value = 'connected'
      error.value = ''
      connectedAt.value = new Date().toISOString()
      if (import.meta.env.DEV) {
        console.info('[MQTT] connected', normalized.subscribeTopics)
      }
      if (normalized.subscribeTopics.length) {
        client?.subscribe(normalized.subscribeTopics, { qos: normalized.qos }, (err) => {
          if (!err) return
          error.value = err.message || '实时主题订阅失败'
          status.value = 'error'
        })
      }
    })

    client.on('reconnect', () => {
      status.value = 'reconnecting'
    })
    client.on('offline', () => {
      status.value = 'offline'
    })
    client.on('close', () => {
      if (status.value !== 'disabled') status.value = 'offline'
    })
    client.on('error', (err) => {
      error.value = err?.message || '实时通道连接失败'
      status.value = 'error'
    })
    client.on('message', (topic, payload) => {
      handleMessage(topic, payload, normalized)
    })
  }

  function handleMessage(topic, payload, config) {
    const receivedAt = new Date().toISOString()
    const text = payload?.toString?.() || ''
    let body = {}
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = { message: text }
    }
    const event = String(body.event || topic.split('/').filter(Boolean).at(-1) || '').trim()
    if (config.events.length && event && !config.events.includes(event)) return
    dispatchMessage({ topic, event, payload: body, receivedAt }, config)
  }

  function dispatchMessage(message, config) {
    const messageId = String(message?.payload?.id || '').trim()
    if (messageId && seenMessageIds.has(messageId)) return
    if (messageId) rememberMessageId(messageId)
    const { topic, event, payload: body } = message
    if (config.events.length && event && !config.events.includes(event)) return
    lastMessage.value = message
    recentMessages.value = [message, ...recentMessages.value].slice(0, MAX_RECENT_MESSAGES)
    if (import.meta.env.DEV) {
      console.info('[MQTT] message', topic, event)
    }

    window.dispatchEvent(new CustomEvent('walleven:mqtt', { detail: message }))
    if (event) {
      window.dispatchEvent(
        new CustomEvent(`walleven:${event.replaceAll('.', '-')}`, { detail: message }),
      )
    }
    if (event === 'system.alert') {
      notificationService.info(String(body.message || body.title || '收到新的系统通知'), {
        duration: 5000,
      })
    }
    if (event === 'subscription.updated' && body.notify !== false) {
      notificationService.success(String(body.message || '套餐权益已更新'), {
        duration: 4200,
      })
    }
    if (event === 'wallet.updated' && body.notify === true) {
      notificationService.success(String(body.message || '钱包余额已更新'), {
        duration: 3600,
      })
    }
    if (event === 'ai_job.updated' && body.status === 'completed' && body.notify !== false) {
      notificationService.success(String(body.message || 'AI 任务已完成'), {
        duration: 4200,
      })
    }
    if (event === 'ai_job.updated' && body.status === 'failed' && body.notify !== false) {
      notificationService.error(String(body.message || body.error || 'AI 任务执行失败'), {
        duration: 5200,
      })
    }
    if (event === 'share.updated' && body.notify === true) {
      const approved = body.action === 'approved'
      notificationService[approved ? 'success' : 'warning'](
        String(body.message || (approved ? '作品已通过审核并公开展示' : '作品审核状态已更新')),
        { duration: 4800 },
      )
    }
    if (event === 'wallhaven.cooldown' && body.action === 'started') {
      notificationService.warning(
        String(body.message || 'Wallhaven 上游触发限流，搜索会在冷却结束后自动恢复'),
        { duration: 5200 },
      )
    }
  }

  function stop() {
    stopClient()
    stopCatchup()
    activeSignature = ''
    activeUserId = ''
    catchupCursor = ''
    seenMessageIds.clear()
    status.value = 'idle'
    connectedAt.value = ''
  }

  function stopClient() {
    const current = client
    client = null
    if (current) current.end(true)
  }

  function startCatchup() {
    catchupEnabled = true
    if (catchupTimer || catchupRequest) return
    void runCatchup()
  }

  async function runCatchup() {
    if (catchupRequest) return catchupRequest
    catchupActive.value = true
    catchupRequest = (async () => {
      try {
        let pageCount = 0
        let hasMore = true
        while (hasMore && pageCount < 4) {
          const page = await fetchRealtimeEvents(catchupCursor, 50)
          catchupCursor = page.cursor || catchupCursor
          page.events.forEach((envelope) => {
            const event = String(envelope?.event || '').trim()
            if (!event) return
            dispatchMessage(
              {
                topic: `walleven/catchup/${event}`,
                event,
                payload: envelope,
                receivedAt: new Date().toISOString(),
              },
              normalizeConfig({ events: [] }),
            )
          })
          hasMore = page.hasMore
          pageCount += 1
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[MQTT] catch-up deferred', err?.message || err)
        }
      } finally {
        catchupRequest = null
        catchupActive.value = false
        if (catchupEnabled) scheduleCatchup()
      }
    })()
    return catchupRequest
  }

  function scheduleCatchup() {
    if (!catchupEnabled) return
    if (catchupTimer) window.clearTimeout(catchupTimer)
    catchupTimer = window.setTimeout(
      () => {
        catchupTimer = null
        void runCatchup()
      },
      document.visibilityState === 'visible' ? CATCHUP_INTERVAL_MS : CATCHUP_INTERVAL_MS * 3,
    )
  }

  function stopCatchup() {
    catchupEnabled = false
    if (catchupTimer) window.clearTimeout(catchupTimer)
    catchupTimer = null
    catchupRequest = null
    catchupActive.value = false
  }

  function rememberMessageId(id) {
    seenMessageIds.add(id)
    if (seenMessageIds.size <= MAX_SEEN_MESSAGE_IDS) return
    const oldest = seenMessageIds.values().next().value
    if (oldest) seenMessageIds.delete(oldest)
  }

  return {
    status,
    error,
    connectedAt,
    lastMessage,
    recentMessages,
    catchupActive,
    isConnected,
    start,
    stop,
  }
})

function normalizeConfig(config = {}) {
  return {
    enabled: config.enabled === true,
    brokerUrl: String(config.brokerUrl || '').trim(),
    subscribeTopics: Array.isArray(config.subscribeTopics)
      ? config.subscribeTopics.map((topic) => String(topic || '').trim()).filter(Boolean)
      : [],
    events: Array.isArray(config.events)
      ? config.events.map((event) => String(event || '').trim()).filter(Boolean)
      : [],
    qos: Number(config.qos) === 1 ? 1 : 0,
    keepalive: Math.min(300, Math.max(15, Number(config.keepalive || 60))),
    reconnectPeriod: Math.min(30000, Math.max(1000, Number(config.reconnectPeriod || 5000))),
    clientIdPrefix:
      String(config.clientIdPrefix || 'walleven-web')
        .trim()
        .replace(/[^a-z0-9_-]/gi, '-') || 'walleven-web',
    username: String(config.username || '').trim(),
    password: String(config.password || ''),
  }
}
