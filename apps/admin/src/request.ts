/**
 * 极简 fetch 封装：
 * - credentials: 'include'（Cookie session）
 * - 统一处理 {success,data} / {success:false,code,error}
 * - 401 跳登录、403 与业务错误码统一中文 toast
 */
import { ElMessage } from 'element-plus'

/** 业务错误码 → 中文提示（见 docs/API_CONTRACT.md） */
const CODE_MESSAGES: Record<string, string> = {
  auth_required: '登录已失效，请重新登录',
  admin_required: '需要管理员权限',
  invalid_credentials: '邮箱或密码错误',
  email_exists: '该邮箱已被注册',
  insufficient_balance: '余额不足',
  task_not_found: '任务不存在',
  task_not_cancelable: '任务当前状态不可取消',
  user_task_limit: '该用户并发任务数已达上限',
  upload_too_large: '文件过大',
  unsupported_file: '不支持的文件类型',
  plan_not_found: '套餐不存在',
  order_not_found: '订单不存在',
  order_not_payable: '订单当前状态不可操作',
  submission_not_allowed: '不允许的投稿操作',
  not_found: '资源不存在',
  validation_error: '参数校验失败',
  rate_limited: '请求过于频繁，请稍后再试',
  internal_error: '服务器内部错误',
  network_error: '网络请求失败，请检查网络',
}

export class ApiError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

type Query = Record<string, string | number | boolean | null | undefined>

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  query?: Query
  body?: unknown
  /** true 时不弹全局错误提示（调用方自行处理） */
  silent?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, silent = false } = options

  let url = path
  if (query) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') qs.set(key, String(value))
    }
    const str = qs.toString()
    if (str) url += (url.includes('?') ? '&' : '?') + str
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    if (!silent) ElMessage.error(CODE_MESSAGES.network_error)
    throw new ApiError('network_error', CODE_MESSAGES.network_error, 0)
  }

  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    // 非 JSON 响应（如网关 5xx），走下面的统一失败处理
  }

  const envelope = payload as
    | { success: true; data: T }
    | { success: false; code?: string; error?: string }
    | null

  if (envelope && envelope.success === true) {
    return envelope.data
  }

  const code = (envelope && envelope.success === false && envelope.code) || `http_${res.status}`
  const serverMessage = (envelope && envelope.success === false && envelope.error) || ''
  const message = CODE_MESSAGES[code] ?? serverMessage ?? `请求失败（${res.status}）`

  if (res.status === 401) {
    // 会话失效：回登录页（避免在登录页上循环跳转）
    if (!location.pathname.endsWith('/login')) {
      location.assign(`${import.meta.env.BASE_URL}login`)
    }
    throw new ApiError(code, message, 401)
  }

  if (!silent) ElMessage.error(message || '请求失败')
  throw new ApiError(code, message || '请求失败', res.status)
}

/** cursor 分页统一响应 */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

/** 兼容"数组 / 分页对象"两种列表返回 */
export function normalizeList<T>(data: T[] | { items: T[]; nextCursor?: string | null }): Page<T> {
  if (Array.isArray(data)) return { items: data, nextCursor: null }
  return { items: data.items, nextCursor: data.nextCursor ?? null }
}
