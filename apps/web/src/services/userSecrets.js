import axios from 'axios'
import { API_BASE_URL } from './apiBase'
import { getApiData, getApiErrorMessage, isApiSuccess } from './apiResponse'
import { getAuthToken, getCsrfToken } from './auth'
import { attachClientLogHeaders } from './clientLogHeaders'

const userSecretsApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 12000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  validateStatus: () => true,
})

userSecretsApi.interceptors.request.use((config) => {
  return attachClientLogHeaders(config)
})

function secretHeaders() {
  const token = getAuthToken()
  const csrfToken = getCsrfToken()
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  }
}

function normalizeResponse(response, label) {
  if (
    response.status < 200 ||
    response.status >= 300 ||
    !isApiSuccess(response.data, response.status)
  ) {
    throw new Error(getApiErrorMessage(response.data, `${label}(${response.status})`))
  }
  return getApiData(response.data)
}

export async function fetchUserSecrets() {
  const response = await userSecretsApi.get('/user/secrets', {
    headers: secretHeaders(),
  })
  return normalizeResponse(response, '读取敏感设置失败')
}

export async function saveUserSecret(key, value) {
  const response = await userSecretsApi.put(
    `/user/secrets/${encodeURIComponent(key)}`,
    { value },
    {
      headers: secretHeaders(),
    },
  )
  return normalizeResponse(response, '保存敏感设置失败')
}

export async function deleteUserSecret(key) {
  const response = await userSecretsApi.delete(`/user/secrets/${encodeURIComponent(key)}`, {
    headers: secretHeaders(),
  })
  return normalizeResponse(response, '删除敏感设置失败')
}
