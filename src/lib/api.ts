import { validWeekly, validExceptions, type DayPatch, type ExceptionInput } from './adminSchedule'
import { isAdminService, type ServiceInput } from './adminService'
import { isAdminBooking, type BookingFilters, type AdminBookingList } from './adminBooking'
import { BOOKING_TIMEZONE, isLocalDate, type PublicService, type Availability, type BookingInput, type BookingConfirmation } from './booking'

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
  readonly retryAfterSeconds?: number

  constructor(message: string, status: number, code?: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
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
  let retryAfterSeconds: number | undefined
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    const numeric = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN
    const date = retryAfter ? Date.parse(retryAfter) : NaN
    retryAfterSeconds = Number.isFinite(numeric) ? numeric : Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : 60
    message = retryAfter
      ? `Muitas tentativas. Tente novamente em ${retryAfterSeconds} segundos.`
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
  return new ApiError(message, response.status, payload.code, retryAfterSeconds)
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

export async function apiFetch(path: string, init: RequestInit = {}, onDispatch?: () => void) {
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

  init.signal?.throwIfAborted()
  onDispatch?.()
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

export async function getPublicServices(signal?: AbortSignal) {
  const payload = await requestJson<{ data: PublicService[] }>(
    '/api/services',
    'Não foi possível carregar os serviços.',
    { signal },
  )
  if (
    !Array.isArray(payload.data) ||
    !payload.data.every(
      (item) =>
        item &&
        Number.isSafeInteger(item.id) &&
        item.id > 0 &&
        typeof item.name === 'string' &&
        (item.description === null || typeof item.description === 'string') &&
        Number.isSafeInteger(item.priceCents) &&
        item.priceCents >= 0 &&
        typeof item.isActive === 'boolean',
    )
  )
    throw new Error('Resposta de serviços inválida. Tente atualizar a lista.')
  return payload.data.filter((item) => item.isActive)
}
export async function getPublicAvailability(
  date: string,
  signal?: AbortSignal,
) {
  const payload = await requestJson<{ data: Availability }>(
    `/api/availability?date=${encodeURIComponent(date)}`,
    'Não foi possível consultar os horários.',
    { signal },
  )
  const data = payload.data
  if (
    !data ||
    data.localDate !== date ||
    data.timezone !== BOOKING_TIMEZONE ||
    data.slotDurationMinutes !== 60 ||
    !Array.isArray(data.slots) ||
    data.slots.length > 24 ||
    !data.slots.every(
      (slot) =>
        slot &&
        typeof slot === 'object' &&
        Number.isInteger(slot.startsAtMinute) &&
        slot.startsAtMinute >= 0 &&
        slot.startsAtMinute <= 1380 &&
        slot.startsAtMinute % 60 === 0 &&
        slot.endsAtMinute === slot.startsAtMinute + 60 &&
        typeof slot.startsAtLocal === 'string' &&
        typeof slot.endsAtLocal === 'string' &&
        typeof slot.startsAtUtc === 'string' &&
        typeof slot.endsAtUtc === 'string' &&
        Number.isFinite(slot.startOffsetMinutes) &&
        Number.isFinite(slot.endOffsetMinutes),
    ) ||
    new Set(data.slots.map((slot) => slot.startsAtMinute)).size !==
      data.slots.length
  )
    throw new Error(
      'Resposta de horários inválida. Atualize a disponibilidade.',
    )
  return data
}
export class BookingOutcomeUnknownError extends Error {
  constructor() {
    super(
      'Não recebemos uma confirmação. A reserva pode ter sido criada. Não envie novamente: entre em contato com a barbearia para verificar seu agendamento.',
    )
    this.name = 'BookingOutcomeUnknownError'
  }
}
export async function createPublicBooking(
  input: BookingInput,
  signal?: AbortSignal,
) {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), 20000)
  let dispatched = false
  try {
    const response = await apiFetch(
      '/api/bookings',
      {
        ...jsonBody({
          serviceId: input.serviceId,
          localDate: input.localDate,
          startsAtMinute: input.startsAtMinute,
          name: input.name,
          phone: input.phone,
        }),
        signal: signal
          ? AbortSignal.any([signal, timeout.signal])
          : timeout.signal,
      },
      () => {
        dispatched = true
      },
    )
    const payload = await readPayload(response)
    if (!response.ok)
      throw apiError(response, payload, 'Não foi possível confirmar a reserva.')
    const data = (payload as ApiPayload & { data?: BookingConfirmation }).data
    if (
      response.status !== 201 ||
      !data ||
      !Number.isSafeInteger(data.id) ||
      data.id < 1 ||
      data.status !== 'confirmed' ||
      data.timezone !== BOOKING_TIMEZONE ||
      data.slotDurationMinutes !== 60 ||
      !isLocalDate(data.localDate) ||
      !Number.isInteger(data.startsAtMinute) ||
      data.startsAtMinute < 0 ||
      data.startsAtMinute > 1380 ||
      data.startsAtMinute % 60 !== 0 ||
      typeof data.serviceName !== 'string' ||
      data.serviceName.trim().length < 2 ||
      !Number.isSafeInteger(data.priceCents) ||
      data.priceCents < 0 ||
      typeof data.startsAtLocal !== 'string' ||
      !data.startsAtLocal.startsWith(`${data.localDate}T`) ||
      typeof data.endsAtLocal !== 'string' ||
      !Number.isFinite(Date.parse(data.startsAtLocal)) ||
      Date.parse(data.endsAtLocal) - Date.parse(data.startsAtLocal) !== 3600000
    )
      throw new BookingOutcomeUnknownError()
    return data
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (!dispatched)
      throw new Error(
        'Não foi possível preparar o envio. Nenhuma reserva foi enviada. Atualize a página e tente novamente.',
      )
    throw new BookingOutcomeUnknownError()
  } finally {
    clearTimeout(timer)
  }
}

export async function getAdminBookings(
  filters: BookingFilters,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    page: String(filters.page),
    perPage: String(filters.perPage),
  })
  const payload = await requestJson<AdminBookingList>(
    `/api/admin/bookings?${query}`,
    'Não foi possível consultar as reservas.',
    { signal, cache: 'no-store' },
  )
  const meta = payload.meta
  if (
    !Array.isArray(payload.data) ||
    !payload.data.every(isAdminBooking) ||
    !meta ||
    ![meta.page, meta.perPage, meta.total, meta.lastPage].every(
      Number.isSafeInteger,
    ) ||
    meta.page !== filters.page ||
    meta.perPage !== filters.perPage ||
    meta.total < 0 ||
    meta.perPage < 1 ||
    meta.perPage > 100 ||
    meta.lastPage !== Math.max(1, Math.ceil(meta.total / meta.perPage)) ||
    payload.data.length > meta.perPage
  )
    throw new Error('Resposta de reservas inválida. Atualize a consulta.')
  return payload
}
export class CancellationOutcomeUnknownError extends Error {
  constructor() {
    super(
      'Não foi possível confirmar o resultado do cancelamento. Atualize a lista antes de tentar novamente.',
    )
    this.name = 'CancellationOutcomeUnknownError'
  }
}
export async function cancelAdminBooking(
  id: number,
  reason: string,
  signal?: AbortSignal,
) {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), 20000)
  let dispatched = false
  try {
    const response = await apiFetch(
      `/api/admin/bookings/${id}/cancel`,
      {
        ...jsonBody({ reason: reason.trim() }),
        signal: signal
          ? AbortSignal.any([signal, timeout.signal])
          : timeout.signal,
      },
      () => {
        dispatched = true
      },
    )
    const payload = await readPayload(response)
    if (!response.ok)
      throw apiError(response, payload, 'Não foi possível cancelar a reserva.')
    const booking = (payload as { data?: unknown }).data
    if (
      response.status !== 200 ||
      !isAdminBooking(booking) ||
      booking.id !== id ||
      booking.status !== 'cancelled'
    )
      throw new CancellationOutcomeUnknownError()
    return booking
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (!dispatched)
      throw new Error(
        'Não foi possível preparar o envio do cancelamento. Atualize a página e tente novamente.',
      )
    throw new CancellationOutcomeUnknownError()
  } finally {
    clearTimeout(timer)
  }
}

export async function getAdminServices(signal?: AbortSignal) {
  const payload = await requestJson<{ data?: unknown }>(
    '/api/admin/services',
    'Não foi possível consultar os serviços.',
    { signal, cache: 'no-store' },
  )
  if (
    !Array.isArray(payload.data) ||
    !payload.data.every(isAdminService) ||
    new Set(payload.data.map((s) => s.id)).size !== payload.data.length
  )
    throw new Error('Resposta de serviços inválida. Atualize a lista.')
  return payload.data
}
export class ServiceOutcomeUnknownError extends Error {
  constructor() {
    super(
      'Resultado não confirmado. O serviço pode ter sido salvo. Atualize a lista e confira os dados antes de uma nova operação; não há reenvio automático.',
    )
    this.name = 'ServiceOutcomeUnknownError'
  }
}
export async function saveAdminService(
  id: number | null,
  input: Partial<ServiceInput>,
  signal?: AbortSignal,
) {
  const body: Partial<ServiceInput> = {}
  // Never serialize the model, ID, timestamps or arbitrary caller fields.
  for (const key of ['name', 'description', 'priceCents', 'durationMinutes', 'isActive'] as const) {
    if (Object.hasOwn(input, key)) Object.assign(body, { [key]: input[key] })
  }
  const timeout = new AbortController(),
    timer = setTimeout(() => timeout.abort(), 20000)
  let dispatched = false
  try {
    const response = await apiFetch(
      id === null ? '/api/admin/services' : `/api/admin/services/${id}`,
      {
        ...jsonBody(body),
        method: id === null ? 'POST' : 'PATCH',
        signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
      },
      () => {
        dispatched = true
      },
    )
    const payload = await readPayload(response)
    if (!response.ok) throw apiError(response, payload, 'Não foi possível salvar o serviço.')
    const service = (payload as { data?: unknown }).data
    if (
      response.status !== (id === null ? 201 : 200) ||
      !isAdminService(service) ||
      (id !== null && service.id !== id)
    )
      throw new ServiceOutcomeUnknownError()
    return service
  } catch (failure) {
    if (failure instanceof ApiError) throw failure
    if (dispatched) throw new ServiceOutcomeUnknownError()
    throw new Error(
      'Não foi possível preparar o envio. Nenhum serviço foi enviado. Atualize a página e tente novamente.',
    )
  } finally {
    clearTimeout(timer)
  }
}


export class ScheduleOutcomeUnknownError extends Error {
  constructor() {
    super(
      'Resultado não confirmado. A configuração pode ter sido salva. Recarregue o calendário antes de outra operação.',
    )
    this.name = 'ScheduleOutcomeUnknownError'
  }
}
const validTag = (tag: string | null): tag is string => !!tag && /^"[a-f0-9]{64}"$/.test(tag)
async function readSchedule<T>(
  path: string,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
) {
  const response = await apiFetch(path, { signal, cache: 'no-store' })
  const payload = await readPayload(response)
  if (!response.ok) throw apiError(response, payload, 'Não foi possível consultar o calendário.')
  const data = (payload as { data?: unknown }).data,
    tag = response.headers.get('ETag')
  if (!validate(data) || !validTag(tag))
    throw new Error(
      'Resposta ou revisão de calendário inválida. Recarregue; se persistir, contate o suporte.',
    )
  return { data, tag }
}
export const getWeeklySchedule = (signal?: AbortSignal) =>
  readSchedule('/api/admin/booking-settings', validWeekly, signal)
export const getDateExceptions = (date: string, signal?: AbortSignal) =>
  readSchedule(
    `/api/admin/calendar-exceptions?${new URLSearchParams({ from: date, to: date })}`,
    (value): value is import('./adminSchedule').DateExceptions => validExceptions(value, date),
    signal,
  )
export async function saveSchedule(
  kind: 'weekly' | 'date',
  input: DayPatch | ExceptionInput,
  tag: string,
  signal?: AbortSignal,
) {
  if (!validTag(tag)) throw new Error('Recarregue a revisão do calendário antes de salvar.')
  const timeout = new AbortController(),
    timer = setTimeout(() => timeout.abort(), 20000)
  let dispatched = false
  try {
    const response = await apiFetch(
      kind === 'weekly' ? '/api/admin/booking-settings' : '/api/admin/calendar-exceptions',
      {
        ...jsonBody(kind === 'weekly' ? { days: [input] } : input),
        method: kind === 'weekly' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', 'If-Match': tag },
        signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
      },
      () => {
        dispatched = true
      },
    )
    const payload = await readPayload(response)
    if (!response.ok) throw apiError(response, payload, 'Não foi possível salvar o calendário.')
    const data = (payload as { data?: unknown }).data
    if (
      response.status !== 200 ||
      !validTag(response.headers.get('ETag')) ||
      (kind === 'weekly'
        ? !validWeekly(data)
        : !validExceptions(data, (input as ExceptionInput).localDate))
    )
      throw new ScheduleOutcomeUnknownError()
  } catch (failure) {
    if (failure instanceof ApiError) throw failure
    if (dispatched) throw new ScheduleOutcomeUnknownError()
    throw failure
  } finally {
    clearTimeout(timer)
  }
}
