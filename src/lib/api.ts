const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''

type ApiPayload = {
  code?: string
  message?: string
  errors?: Record<string, string[]> | Array<{ message: string }>
}

export type AdminUser = {
  id: number
  fullName: string | null
  email: string
  role: 'admin'
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function isSessionDenied(error: unknown) {
  return error instanceof ApiError && (
    error.status === 401 || (error.status === 403 && error.code !== 'E_BAD_CSRF_TOKEN')
  )
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Erro inesperado.'
}

async function readPayload(response: Response): Promise<ApiPayload> {
  try {
    const payload: unknown = await response.json()
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  } catch {
    return {}
  }
}

function apiError(response: Response, payload: ApiPayload, fallback: string) {
  let message = fallback
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    message = retryAfter
      ? `Muitas tentativas. Tente novamente em ${retryAfter} segundos.`
      : 'Muitas tentativas. Aguarde antes de tentar novamente.'
  } else if (response.status === 419 || (response.status === 403 && payload.code === 'E_BAD_CSRF_TOKEN')) {
    message = 'Sessão CSRF expirada. Atualize a página e tente novamente.'
  } else if (response.status === 401) {
    message = payload.message || 'Credenciais inválidas ou sessão expirada.'
  } else {
    const validationError = Array.isArray(payload.errors)
      ? payload.errors[0]?.message
      : payload.errors && Object.values(payload.errors)[0]?.[0]
    message = validationError || payload.message || fallback
  }
  return new ApiError(message, response.status, payload.code)
}

function xsrfToken() {
  const cookie = document.cookie.split(/;\s*/).find((item) => item.startsWith('XSRF-TOKEN='))
  try {
    return cookie ? decodeURIComponent(cookie.slice('XSRF-TOKEN='.length)) : undefined
  } catch {
    return undefined
  }
}

let csrfRequest: Promise<void> | null = null

async function primeCsrf() {
  // Share only an in-flight bootstrap, never cache a session token or a failed response.
  if (!csrfRequest) {
    csrfRequest = (async () => {
      const response = await fetch(`${API_URL}/api/csrf`, { credentials: 'include' })
      if (!response.ok) {
        throw apiError(response, await readPayload(response), 'Não foi possível preparar a proteção CSRF.')
      }
    })().finally(() => { csrfRequest = null })
  }
  return csrfRequest
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    let token = xsrfToken()
    if (!token) {
      await primeCsrf()
      token = xsrfToken()
    }
    if (!token) {
      throw new Error('Não foi possível preparar a proteção CSRF. Atualize a página e tente novamente.')
    }
    headers.set('X-XSRF-TOKEN', token)
  } else {
    // Session reads must not depend on a readable CSRF cookie or forward its token.
    headers.delete('X-XSRF-TOKEN')
  }

  return fetch(`${API_URL}${path}`, { ...init, method, headers, credentials: 'include' })
}

async function requestJson<T>(path: string, fallback: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init)
  const payload = await readPayload(response)
  if (!response.ok) throw apiError(response, payload, fallback)
  return payload as T
}

const jsonBody = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})

export async function submitCustomer(name: string, phone: string) {
  const payload = await requestJson<ApiPayload>(
    '/api/customers', 'Não foi possível cadastrar o cliente.', jsonBody({ name, phone }),
  )
  return payload.message || 'Solicitação recebida.'
}

function adminUser(payload: { user?: AdminUser }) {
  if (!payload.user || payload.user.role !== 'admin') {
    throw new Error('Não foi possível confirmar a sessão administrativa.')
  }
  return payload.user
}

export async function getAdminSession(signal?: AbortSignal) {
  const payload = await requestJson<{ user?: AdminUser }>(
    '/api/admin/me', 'Não foi possível verificar a sessão.', { signal },
  )
  return adminUser(payload)
}

export async function loginAdmin(email: string, password: string) {
  const payload = await requestJson<{ user?: AdminUser }>(
    '/api/admin/login', 'Credenciais inválidas.', jsonBody({ email, password }),
  )
  return adminUser(payload)
}

export async function logoutAdmin() {
  await requestJson('/api/admin/logout', 'Não foi possível sair da gestão.', { method: 'POST' })
}
