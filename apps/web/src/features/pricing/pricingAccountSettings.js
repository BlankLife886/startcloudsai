export function accountAvatarInitial(user = {}, fallback = '?') {
  const source = String(user.displayName || user.email || '').trim()
  if (!source) return fallback
  return source.charAt(0).toUpperCase()
}

export function resolveAccountRoleLabel(role = '') {
  const normalized = String(role || 'user').trim().toLowerCase()
  if (normalized === 'admin') return '管理员'
  if (normalized === 'user') return '普通用户'
  return String(role || '用户')
}

export function buildAccountSettingsStats(input = {}) {
  const availableUsd = Number(input.availableUsd ?? 0)
  const activeKeyCount = Number(input.activeKeyCount ?? 0)
  const monthCallCount = Number(input.monthCallCount ?? 0)

  return [
    {
      id: 'balance',
      label: '美元余额',
      value: input.balanceDisplay || '$0',
      hint: '可用于 API 调用',
      tone: 'green',
      icon: 'bi-wallet2',
      animateValue: availableUsd,
      animateFormat: 'usd',
      animateDelay: 0,
    },
    {
      id: 'plan',
      label: '当前套餐',
      value: input.planLabel || '未订阅',
      hint: input.planUnsubscribed ? '选择适合你的方案' : input.planHint || '查看套餐详情',
      tone: 'blue',
      icon: 'bi-box-seam',
      ...(input.planUnsubscribed
        ? { actionLabel: '去订阅', actionSection: 'plans' }
        : {}),
    },
    {
      id: 'keys',
      label: '活跃密钥',
      value: String(activeKeyCount),
      hint: '可用于 API 鉴权',
      tone: 'amber',
      icon: 'bi-key',
      animateValue: activeKeyCount,
      animateFormat: 'integer',
      animateDelay: 140,
    },
    {
      id: 'usage',
      label: '本月调用',
      value: String(monthCallCount),
      hint: input.usageHint || '成功请求次数',
      tone: 'cyan',
      icon: 'bi-activity',
      animateValue: monthCallCount,
      animateFormat: 'integer',
      animateDelay: 70,
    },
  ]
}

export function buildAccountInfoRows(input = {}) {
  const rows = []
  if (input.displayName) {
    rows.push({ id: 'name', label: '显示名称', value: input.displayName, copyable: false })
  }
  if (input.email) {
    rows.push({ id: 'email', label: '登录邮箱', value: input.email, copyable: true })
  }
  if (input.userId) {
    rows.push({ id: 'id', label: '用户 ID', value: input.userId, copyable: true, mono: true })
  }
  if (input.role) {
    rows.push({
      id: 'role',
      label: '账号角色',
      value: input.roleLabel || input.role,
      copyable: false,
    })
  }
  if (input.baseUrl) {
    rows.push({
      id: 'baseUrl',
      label: 'API Base URL',
      value: input.baseUrl,
      copyable: true,
      mono: true,
    })
  }
  return rows
}

export function buildAccountSecurityActions() {
  return [
    {
      id: 'forgot',
      kind: 'route',
      to: { name: 'auth', query: { mode: 'forgot', redirect: '/pricing?section=settings' } },
      label: '修改密码',
      desc: '通过邮箱验证重置登录密码',
      icon: 'bi-shield-lock',
      tone: 'ghost',
    },
    {
      id: 'app-settings',
      kind: 'route',
      to: '/settings',
      label: '客户端偏好',
      desc: '主题、下载与壁纸应用设置',
      icon: 'bi-sliders',
      tone: 'ghost',
    },
    {
      id: 'logout',
      kind: 'action',
      action: 'logout',
      label: '退出登录',
      desc: '清除当前会话并返回登录页',
      icon: 'bi-box-arrow-right',
      tone: 'danger',
    },
  ]
}
