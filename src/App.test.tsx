import { StrictMode } from 'react'
import { BrowserRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

const admin = { id: 1, fullName: 'Gerente', email: 'admin@example.test', role: 'admin' }
function json(payload: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}
function mockApi(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const path = new URL(input, window.location.origin).pathname
    return Promise.resolve(path === '/api/admin/bookings' ? json({ data: [], meta: { page: 1, perPage: 50, total: 0, lastPage: 1 } }) : handler(path, init))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
function openPage(path = '/') {
  window.history.replaceState(null, '', path)
  return render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
}
function fillLogin() {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'admin@example.test' } })
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'SenhaDeTeste123' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Login do administrador' }))
}
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  document.cookie = 'XSRF-TOKEN=test-token; path=/'
})

it('keeps the public form separate and navigates using real URLs, back and forward', async () => {
  const fetchMock = mockApi((path) => path === '/api/services' ? json({ data: [] }) : json({}, 401))
  openPage()
  expect(screen.getByRole('heading', { name: 'Agende seu horário' })).toBeTruthy()
  expect(fetchMock.mock.calls.every(([url]) => url.endsWith('/api/services'))).toBe(true)
  fireEvent.click(screen.getByRole('link', { name: 'Gestão' }))
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(window.location.pathname).toBe('/admin')
  expect(screen.queryByLabelText('Nome completo')).toBeNull()
  window.history.back()
  await screen.findByRole('heading', { name: 'Agende seu horário' })
  expect(window.location.pathname).toBe('/')
  window.history.forward()
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(window.location.pathname).toBe('/admin')
})

it('shows a not-found page for unknown routes', () => {
  openPage('/nao-existe')
  expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeTruthy()
})

it('restores a valid server session on direct /admin access and on remount without logging out', async () => {
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
  const fetchMock = mockApi(() => json({ ok: true, user: admin }))
  const first = openPage('/admin')
  expect(screen.queryByRole('heading', { name: 'Login do administrador' })).toBeNull()
  await screen.findByRole('heading', { name: 'Área administrativa' })
  expect(screen.getByText('Olá, Gerente.')).toBeTruthy()
  first.unmount()
  openPage('/admin')
  await screen.findByRole('heading', { name: 'Área administrativa' })
  expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  expect(fetchMock.mock.calls.every(([url, init]) => (url.includes('/api/admin/bookings?') || url.endsWith('/api/admin/me')) && init?.credentials === 'include')).toBe(true)
  expect(document.cookie).not.toContain('XSRF-TOKEN=')
  expect(fetchMock.mock.calls.every(([, init]) => !new Headers(init?.headers).has('X-XSRF-TOKEN'))).toBe(true)
})

it.each([401, 403])('shows login for a denied session (%s)', async (status) => {
  mockApi(() => json({ message: status === 403 ? 'Acesso permitido apenas para administradores.' : 'Não autenticado.' }, status))
  openPage('/admin')
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(screen.queryByRole('heading', { name: 'Área administrativa' })).toBeNull()
})

it('keeps a transient session-check failure separate from logout and lets the user retry', async () => {
  let unavailable = true
  mockApi(() => unavailable ? json({}, 503) : json({ user: admin }))
  openPage('/admin')
  await screen.findByRole('heading', { name: 'Verificação de sessão indisponível' })
  expect(screen.queryByRole('heading', { name: 'Login do administrador' })).toBeNull()
  unavailable = false
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  await screen.findByRole('heading', { name: 'Área administrativa' })
})

it('logs in and logs out through the API, updating the visible screen', async () => {
  let authenticated = false
  const fetchMock = mockApi((path, init) => {
    if (path.endsWith('/login')) {
      expect(JSON.parse(init?.body as string)).toEqual({ email: 'admin@example.test', password: 'SenhaDeTeste123' })
      authenticated = true
      return json({ ok: true, user: admin })
    }
    if (path.endsWith('/logout')) {
      authenticated = false
      return json({ ok: true })
    }
    return authenticated ? json({ user: admin }) : json({}, 401)
  })
  openPage('/admin')
  await screen.findByRole('heading', { name: 'Login do administrador' })
  fillLogin()
  await screen.findByRole('heading', { name: 'Área administrativa' })
  expect(screen.queryByLabelText('Senha')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Sair da gestão' }))
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(screen.getByRole('status').textContent).toBe('Sessão encerrada com sucesso.')
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/api/admin/logout'))).toHaveLength(1)
  expect(authenticated).toBe(false)
})

it('keeps the login form and shows the error for invalid credentials', async () => {
  mockApi((path) => json({ message: path.endsWith('/login') ? 'Credenciais inválidas.' : 'Não autenticado.' }, 401))
  openPage('/admin')
  await screen.findByRole('heading', { name: 'Login do administrador' })
  fillLogin()
  expect((await screen.findByRole('alert')).textContent).toBe('Credenciais inválidas.')
  expect(screen.queryByRole('heading', { name: 'Área administrativa' })).toBeNull()
})

it.each([
  [403, { code: 'E_BAD_CSRF_TOKEN' }, {}],
  [419, {}, {}],
  [429, {}, { 'Retry-After': '60' }],
  [500, {}, {}],
])('keeps the authenticated screen when logout fails with %s', async (status, payload, headers) => {
  mockApi((path) => path.endsWith('/logout') ? json(payload, status as number, headers) : json({ user: admin }))
  openPage('/admin')
  await screen.findByRole('heading', { name: 'Área administrativa' })
  fireEvent.click(screen.getByRole('button', { name: 'Sair da gestão' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('heading', { name: 'Área administrativa' })).toBeTruthy()
  expect(screen.queryByText('Sessão encerrada com sucesso.')).toBeNull()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sair da gestão' }).hasAttribute('disabled')).toBe(false))
})

it('returns to login if the API reports that the session has already expired at logout', async () => {
  mockApi((path) => path.endsWith('/logout') ? json({}, 401) : json({ user: admin }))
  openPage('/admin')
  await screen.findByRole('heading', { name: 'Área administrativa' })
  fireEvent.click(screen.getByRole('button', { name: 'Sair da gestão' }))
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(screen.queryByRole('heading', { name: 'Área administrativa' })).toBeNull()
})
