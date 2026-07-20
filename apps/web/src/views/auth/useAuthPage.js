import { ref } from 'vue'

export function useAuthPage() {
  const pageRef = ref(null)

  return {
    pageRef,
  }
}

export function validateEmail(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return '请输入邮箱'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return '邮箱格式不正确'
  return ''
}

export function validatePassword(value) {
  if (String(value || '').length < 8) return '密码至少 8 位'
  return ''
}

export function getPasswordMeta(value) {
  const password = String(value || '')
  const checks = [
    { key: 'length', label: '至少 8 位', passed: password.length >= 8 },
    { key: 'letter', label: '包含字母', passed: /[A-Za-z]/.test(password) },
    { key: 'number', label: '包含数字', passed: /\d/.test(password) },
  ]
  const score = checks.filter((item) => item.passed).length
  const label = score >= 3 ? '强' : score >= 2 ? '中' : '弱'

  return {
    checks,
    score,
    label,
    percent: Math.max(12, Math.round((score / checks.length) * 100)),
  }
}
