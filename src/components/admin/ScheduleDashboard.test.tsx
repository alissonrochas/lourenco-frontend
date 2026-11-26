import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '@/App'
import { ScheduleDashboard } from './ScheduleDashboard'
import { admin, deferred, json, list } from '@/test/adminBookingFixtures'
import { todayInSaoPaulo } from '@/lib/booking'
const tag = '"' + 'a'.repeat(64) + '"'
const weekly = {
  timezone: 'America/Sao_Paulo',
  slotDurationMinutes: 60,
  days: Array.from({ length: 7 }, (_, i) => ({
    weekday: i + 1,
    isConfigured: true,
    isActive: true,
    opensAtMinute: 540,
    closesAtMinute: 1080,
    breaks: [],
    slotBlocks: [],
  })),
}
const dates = { dateBlocks: [], slotBlocks: [] }
const response = (data: unknown) => json({ data }, 200, { ETag: tag })
type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined
function mockApi(handler?: Handler) {
  const mock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, location.origin),
      custom = handler?.(url, init)
    if (custom) return custom
    if (url.pathname === '/api/admin/me' || url.pathname === '/api/admin/login')
      return json({ user: admin })
    if (url.pathname === '/api/admin/bookings') return json(list([]))
    if (url.pathname === '/api/admin/logout') return json({ ok: true })
    if (url.pathname === '/api/csrf') {
      document.cookie = 'XSRF-TOKEN=fresh; path=/'
      return json({ ok: true })
    }
    return response(url.pathname === '/api/admin/booking-settings' ? weekly : dates)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}
async function open() {
  window.history.replaceState(null, '', '/admin')
  render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Horários' }))
  await screen.findByLabelText('Dia da semana')
}
function review() {
  fireEvent.submit(screen.getByRole('form', { name: 'Configurar dia semanal' }))
}
function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar calendário' }))
}
beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=token; path=/'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('loads server configuration without inventing hours and shows date records', async () => {
  mockApi()
  await open()
  expect((screen.getByLabelText('Abertura') as HTMLSelectElement).value).toBe('540')
  expect(screen.getByText('Nenhum bloqueio excepcional registrado nesta data.')).toBeTruthy()
})
it('does not fetch calendar before session confirmation or when denied', async () => {
  const session = deferred<Response>(),
    mock = mockApi((u) => (u.pathname === '/api/admin/me' ? session.promise : undefined))
  window.history.replaceState(null, '', '/admin')
  render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  )
  expect(screen.queryByRole('button', { name: 'Horários' })).toBeNull()
  await act(async () => session.resolve(json({}, 401)))
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(mock.mock.calls.every(([u]) => !u.includes('booking-settings'))).toBe(true)
})
it('validates empty/opening and overlapping pauses without writes', async () => {
  const mock = mockApi()
  await open()
  fireEvent.change(screen.getByLabelText('Abertura'), { target: { value: '1080' } })
  review()
  expect(screen.getByRole('alert').textContent).toContain('anterior')
  expect(mock.mock.calls.filter(([, i]) => i?.method === 'PATCH')).toHaveLength(0)
})
it('confirms once with cookies, XSRF and If-Match, then reloads from server', async () => {
  const pending = deferred<Response>(),
    mock = mockApi((_u, i) => (i?.method === 'PATCH' ? pending.promise : undefined))
  await open()
  review()
  expect(mock.mock.calls.filter(([, i]) => i?.method === 'PATCH')).toHaveLength(0)
  const button = screen.getByRole('button', { name: 'Confirmar calendário' })
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() =>
    expect(mock.mock.calls.filter(([, i]) => i?.method === 'PATCH')).toHaveLength(1),
  )
  const init = mock.mock.calls.find(([, i]) => i?.method === 'PATCH')![1]!
  expect(init.credentials).toBe('include')
  expect(new Headers(init.headers).get('If-Match')).toBe(tag)
  expect(new Headers(init.headers).get('X-XSRF-TOKEN')).toBe('token')
  expect(JSON.parse(init.body as string)).toEqual({
    days: [
      {
        weekday: 1,
        isActive: true,
        opensAtMinute: 540,
        closesAtMinute: 1080,
        breaks: [],
        slotBlocks: [],
      },
    ],
  })
  await act(async () => pending.resolve(response(weekly)))
  await screen.findByText(/Calendário salvo/)
})
it('POSTs selected date hours with a private reason, never IDs or timestamps', async () => {
  const mock = mockApi()
  await open()
  fireEvent.change(screen.getByLabelText('Abrangência'), { target: { value: 'slots' } })
  fireEvent.click(screen.getByLabelText('Horário excepcional 11:00'))
  fireEvent.change(screen.getByLabelText('Motivo administrativo (opcional)'), {
    target: { value: ' Folga ' },
  })
  fireEvent.submit(screen.getByRole('form', { name: 'Configurar bloqueios por data' }))
  confirm()
  await waitFor(() => expect(mock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true))
  expect(
    JSON.parse(mock.mock.calls.find(([, i]) => i?.method === 'POST')![1]!.body as string),
  ).toEqual({
    localDate: todayInSaoPaulo(),
    slotBlocks: [{ startsAtMinute: 660, isBlocked: true, reason: 'Folga' }],
  })
})
it.each([401, 403])('clears private state on authorization failure %s', async (status) => {
  let denied = false
  mockApi((u) =>
    denied && u.pathname === '/api/admin/booking-settings'
      ? json({ message: 'Negado' }, status)
      : undefined,
  )
  await open()
  denied = true
  fireEvent.click(screen.getByRole('button', { name: 'Recarregar calendário' }))
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(screen.queryByLabelText('Abertura')).toBeNull()
})
it('keeps CSRF failure distinct from authorization and never auto-retries', async () => {
  const mock = mockApi((_u, i) =>
    i?.method === 'PATCH' ? json({ code: 'E_BAD_CSRF_TOKEN' }, 403) : undefined,
  )
  await open()
  review()
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('CSRF')
  expect(screen.getByRole('heading', { name: 'Área administrativa' })).toBeTruthy()
  expect(mock.mock.calls.filter(([, i]) => i?.method === 'PATCH')).toHaveLength(1)
})
it.each([404, 409, 503])('requires successful reload after %s', async (status) => {
  mockApi((_u, i) =>
    i?.method === 'PATCH' ? json({ message: 'Conflito ou indisponibilidade' }, status) : undefined,
  )
  await open()
  review()
  confirm()
  await waitFor(() => expect(screen.queryByLabelText('Abertura')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Recarregar calendário' }))
  await screen.findByLabelText('Abertura')
})
it('keeps 422 errors for correction', async () => {
  mockApi((_u, i) =>
    i?.method === 'PATCH' ? json({ message: 'Configuração inválida' }, 422) : undefined,
  )
  await open()
  review()
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('Configuração inválida')
  expect(screen.getByRole('dialog')).toBeTruthy()
})
it('respects Retry-After after 429', async () => {
  mockApi((_u, i) => (i?.method === 'PATCH' ? json({}, 429, { 'Retry-After': '60' }) : undefined))
  await open()
  review()
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('60 segundos')
  expect(screen.getByRole('button', { name: 'Aguarde 60s' }).hasAttribute('disabled')).toBe(true)
})
it('blocks after a lost write response and failed reconciliation; then loads successfully without another write', async () => {
  let reads = 0
  const mock = mockApi((u, i) => {
    if (i?.method === 'PATCH') return Promise.reject(new TypeError('Network'))
    if (u.pathname === '/api/admin/booking-settings' && ++reads === 2) return json({}, 503)
  })
  await open()
  review()
  confirm()
  await screen.findByText(/Resultado não confirmado/)
  fireEvent.click(screen.getByRole('button', { name: 'Recarregar calendário' }))
  await waitFor(() => expect(reads).toBe(2))
  expect(screen.queryByLabelText('Abertura')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Recarregar calendário' }))
  await screen.findByLabelText('Abertura')
  expect(mock.mock.calls.filter(([, i]) => i?.method === 'PATCH')).toHaveLength(1)
})
it('rejects reads without a usable server revision', async () => {
  mockApi((u) =>
    u.pathname === '/api/admin/booking-settings' ? json({ data: weekly }) : undefined,
  )
  render(<ScheduleDashboard onDenied={vi.fn()} onBusy={vi.fn()} />)
  expect((await screen.findByRole('alert')).textContent).toContain('revisão')
  expect(screen.queryByLabelText('Abertura')).toBeNull()
})
it('ignores late reads after newer consultation even if abort is ignored', async () => {
  const first = deferred<Response>(),
    second = deferred<Response>()
  let count = 0
  mockApi((u) =>
    u.pathname === '/api/admin/booking-settings'
      ? ++count === 1
        ? first.promise
        : second.promise
      : undefined,
  )
  render(<ScheduleDashboard onDenied={vi.fn()} onBusy={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Recarregar calendário' }))
  await act(async () => second.resolve(response(weekly)))
  await screen.findByLabelText('Abertura')
  await act(async () => first.resolve(response({ ...weekly, timezone: 'UTC' })))
  expect(screen.queryByRole('alert')).toBeNull()
})
it('clears section data and avoids storage on logout', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  mockApi()
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Sair da gestão' }))
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(screen.queryByLabelText('Abertura')).toBeNull()
  expect(storage).not.toHaveBeenCalled()
})
