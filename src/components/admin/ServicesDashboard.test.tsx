import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '@/App'
import { ServicesDashboard } from './ServicesDashboard'
import { admin, deferred, json, list } from '@/test/adminBookingFixtures'
import type { AdminService } from '@/lib/adminService'
const service: AdminService = {
  id: 1,
  name: 'Corte',
  description: 'Descrição',
  priceCents: 4590,
  durationMinutes: 45,
  isActive: true,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: null,
}
type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined
function mockApi(handler?: Handler) {
  const mock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, window.location.origin),
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
    return json({ data: [service, { ...service, id: 2, name: 'Barba', isActive: false }] })
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
  fireEvent.click(await screen.findByRole('button', { name: 'Serviços' }))
  await screen.findByRole('button', { name: 'Editar serviço Corte' })
}
function field(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}
function reviewNew() {
  fireEvent.click(screen.getByRole('button', { name: 'Novo serviço' }))
  field('Nome do serviço', 'Novo corte')
  field('Preço (R$)', '50,25')
  fireEvent.submit(screen.getByRole('form', { name: 'Cadastrar serviço' }))
}
function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar alteração' }))
}
beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=token; path=/'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('lists active and inactive services, price and duration', async () => {
  mockApi()
  await open()
  expect(screen.getByText('Ativo')).toBeTruthy()
  expect(screen.getByText('Inativo')).toBeTruthy()
  expect(screen.getAllByText('R$ 45,90')).toHaveLength(2)
  expect(screen.getAllByText('45 minutos')).toHaveLength(2)
})
it('shows empty list', async () => {
  mockApi((u) => (u.pathname === '/api/admin/services' ? json({ data: [] }) : undefined))
  render(<ServicesDashboard onDenied={vi.fn()} onBusy={vi.fn()} />)
  expect(await screen.findByText('Nenhum serviço cadastrado.')).toBeTruthy()
})
it('waits for session confirmation, denies anonymous access and never fetches services', async () => {
  const session = deferred<Response>(),
    mock = mockApi((u) => (u.pathname === '/api/admin/me' ? session.promise : undefined))
  window.history.replaceState(null, '', '/admin')
  render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  )
  expect(screen.queryByRole('button', { name: 'Serviços' })).toBeNull()
  await act(async () => session.resolve(json({}, 401)))
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(mock.mock.calls.every(([u]) => !u.includes('/api/admin/services'))).toBe(true)
})
it('validates form without dispatching writes', async () => {
  const mock = mockApi()
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Novo serviço' }))
  fireEvent.submit(screen.getByRole('form', { name: 'Cadastrar serviço' }))
  expect(screen.getByRole('alert').textContent).toContain('2 a 120')
  expect(mock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0)
})
it('requires confirmation, sends exact JSON with cookies/CSRF once and reloads server list', async () => {
  const pending = deferred<Response>()
  let created = false
  const mock = mockApi((u, i) => {
    if (u.pathname === '/api/admin/services' && i?.method === 'POST') return pending.promise
    if (created && u.pathname === '/api/admin/services')
      return json({ data: [{ ...service, name: 'Novo corte' }] })
  })
  await open()
  reviewNew()
  expect(mock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0)
  expect(screen.getByRole('dialog').textContent).toContain('Reservas existentes')
  const submit = screen.getByRole('button', { name: 'Confirmar alteração' })
  fireEvent.click(submit)
  fireEvent.click(submit)
  await waitFor(() =>
    expect(mock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1),
  )
  const init = mock.mock.calls.find(([, i]) => i?.method === 'POST')![1]!
  expect(JSON.parse(init.body as string)).toEqual({
    name: 'Novo corte',
    description: null,
    priceCents: 5025,
    durationMinutes: 60,
    isActive: true,
  })
  expect(init.credentials).toBe('include')
  expect(new Headers(init.headers).get('X-XSRF-TOKEN')).toBe('token')
  expect(screen.getByRole('button', { name: 'Serviços' }).hasAttribute('disabled')).toBe(true)
  created = true
  await act(async () => pending.resolve(json({ data: { ...service, name: 'Novo corte' } }, 201)))
  expect(await screen.findByRole('button', { name: 'Editar serviço Novo corte' })).toBeTruthy()
})
it('edits business fields with explicit null and without ID/timestamps', async () => {
  const mock = mockApi((_u, i) =>
    i?.method === 'PATCH'
      ? json({
          data: {
            ...service,
            name: 'Premium',
            description: null,
            priceCents: 6000,
            durationMinutes: 90,
          },
        })
      : undefined,
  )
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Editar serviço Corte' }))
  field('Nome do serviço', 'Premium')
  field('Descrição (opcional)', ' ')
  field('Preço (R$)', '60')
  field('Duração (minutos)', '90')
  fireEvent.submit(screen.getByRole('form', { name: 'Editar serviço' }))
  confirm()
  await waitFor(() => expect(mock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true))
  const [url, init] = mock.mock.calls.find(([, i]) => i?.method === 'PATCH')!
  expect(url).toContain('/api/admin/services/1')
  expect(JSON.parse(init!.body as string)).toEqual({
    name: 'Premium',
    description: null,
    priceCents: 6000,
    durationMinutes: 90,
  })
})
it.each([
  ['Desativar serviço Corte', false],
  ['Ativar serviço Barba', true],
] as const)('confirms %s and PATCHes only isActive', async (action, isActive) => {
  const mock = mockApi((_u, i) =>
    i?.method === 'PATCH'
      ? json({ data: { ...service, id: isActive ? 2 : 1, isActive } })
      : undefined,
  )
  await open()
  fireEvent.click(screen.getByRole('button', { name: action }))
  fireEvent.click(screen.getByRole('button', { name: 'Voltar sem salvar' }))
  expect(mock.mock.calls.filter(([, i]) => i?.method === 'PATCH')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: action }))
  confirm()
  await waitFor(() => expect(mock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true))
  expect(
    JSON.parse(mock.mock.calls.find(([, i]) => i?.method === 'PATCH')![1]!.body as string),
  ).toEqual({ isActive })
})
it.each([401, 403])('removes private data after authorization status %s', async (status) => {
  let revoked = false
  mockApi((u) =>
    revoked && u.pathname === '/api/admin/services'
      ? json({ message: 'Acesso negado' }, status)
      : undefined,
  )
  await open()
  revoked = true
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar serviços' }))
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(screen.queryByText('Descrição')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Novo serviço' })).toBeNull()
})
it('preserves the session on a CSRF error and does not automatically retry', async () => {
  const mock = mockApi((_u, i) =>
    i?.method === 'POST' ? json({ code: 'E_BAD_CSRF_TOKEN' }, 403) : undefined,
  )
  await open()
  reviewNew()
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('CSRF')
  expect(screen.getByRole('heading', { name: 'Área administrativa' })).toBeTruthy()
  expect(mock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1)
})
it.each([409, 503])(
  'blocks new writes until a successful server refresh after %s',
  async (status) => {
    mockApi((_u, i) =>
      i?.method === 'POST' ? json({ message: 'Falha controlada' }, status) : undefined,
    )
    await open()
    reviewNew()
    confirm()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Novo serviço' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar serviços' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Novo serviço' }).hasAttribute('disabled')).toBe(
        false,
      ),
    )
  },
)
it('keeps 422 validation errors in the dialog', async () => {
  mockApi((_u, i) =>
    i?.method === 'POST'
      ? json({ errors: [{ message: 'Nome inválido no servidor' }] }, 422)
      : undefined,
  )
  await open()
  reviewNew()
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('Nome inválido no servidor')
  expect(screen.getByRole('dialog')).toBeTruthy()
})
it('respects Retry-After on 429 without clearing the authenticated session', async () => {
  mockApi((_u, i) =>
    i?.method === 'POST' ? json({ message: 'Limite' }, 429, { 'Retry-After': '60' }) : undefined,
  )
  await open()
  reviewNew()
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('60 segundos')
  expect(screen.getByRole('button', { name: 'Aguarde 60s' }).hasAttribute('disabled')).toBe(true)
})
it('requires successful reconciliation after uncertain network result, including a failed refresh', async () => {
  let reads = 0
  const mock = mockApi((u, i) => {
    if (i?.method === 'POST') return Promise.reject(new TypeError('Network error'))
    if (u.pathname === '/api/admin/services' && ++reads === 2) return json({}, 503)
  })
  await open()
  reviewNew()
  confirm()
  await screen.findByText(/O serviço pode ter sido salvo/)
  expect(screen.getByRole('button', { name: 'Novo serviço' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar serviços' }))
  await waitFor(() => expect(reads).toBe(2))
  expect(screen.getByRole('button', { name: 'Novo serviço' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar serviços' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Novo serviço' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  expect(mock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1)
})
it('ignores old read responses even when the transport ignores abort', async () => {
  const first = deferred<Response>(),
    second = deferred<Response>()
  let count = 0
  mockApi((u) =>
    u.pathname === '/api/admin/services'
      ? ++count === 1
        ? first.promise
        : second.promise
      : undefined,
  )
  render(<ServicesDashboard onDenied={vi.fn()} onBusy={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar serviços' }))
  await act(async () => second.resolve(json({ data: [{ ...service, name: 'Atual' }] })))
  await screen.findByText('Atual')
  await act(async () => first.resolve(json({ data: [{ ...service, name: 'Antigo' }] })))
  expect(screen.queryByText('Antigo')).toBeNull()
})
it('cleans private data on logout and never writes client storage', async () => {
  const local = vi.spyOn(Storage.prototype, 'setItem')
  mockApi()
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Sair da gestão' }))
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(screen.queryByText('Descrição')).toBeNull()
  expect(local).not.toHaveBeenCalled()
})
