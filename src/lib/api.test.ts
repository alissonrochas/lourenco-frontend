import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, getAdminSession, isSessionDenied, submitCustomer } from './api'

function json(payload: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

beforeEach(() => { document.cookie = 'XSRF-TOKEN=token%3Ddecoded; path=/' })

describe('API transport and public response', () => {
  it.each([undefined, 'GET', 'HEAD', 'OPTIONS'])('does not bootstrap CSRF for method %s without an XSRF cookie', async (method) => {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
    const fetchMock = vi.fn().mockResolvedValue(json({}))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/admin/me', { method, credentials: 'omit' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/admin\/me$/)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('include')
    expect(init.method).toBe(method ?? 'GET')
    expect(new Headers(init.headers).has('X-XSRF-TOKEN')).toBe(false)
  })

  it('restores the authenticated admin session without an XSRF cookie', async () => {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
    const user = { id: 1, fullName: 'Gerente', email: 'admin@example.test', role: 'admin' }
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true, user }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdminSession()).resolves.toEqual(user)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/admin\/me$/)
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })

  it('preserves a session authentication failure without trying to prepare CSRF', async () => {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
    const fetchMock = vi.fn().mockResolvedValue(json({ message: 'Não autenticado.' }, 401))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdminSession()).rejects.toMatchObject({ status: 401, message: 'Não autenticado.' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/admin\/me$/)
  })

  it('does not read or send CSRF on GET even when a token or header is present', async () => {
    const cookieRead = vi.spyOn(document, 'cookie', 'get')
    const fetchMock = vi.fn().mockResolvedValue(json({}))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/admin/me', { headers: { 'X-XSRF-TOKEN': 'caller-token', Accept: 'application/json' } })
    expect(cookieRead).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.has('X-XSRF-TOKEN')).toBe(false)
    expect(headers.get('Accept')).toBe('application/json')
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])('bootstraps and sends CSRF for a %s request without a token', async (method) => {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      expect(init?.credentials).toBe('include')
      if (input.endsWith('/api/csrf')) {
        document.cookie = 'XSRF-TOKEN=fresh%3Dtoken; path=/'
        return json({})
      }
      expect(init?.method).toBe(method.toUpperCase())
      expect(new Headers(init?.headers).get('X-XSRF-TOKEN')).toBe('fresh=token')
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/write', { method })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/csrf$/)
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/write$/)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks %s if bootstrap succeeds without setting the XSRF cookie', async (method) => {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
    const fetchMock = vi.fn().mockResolvedValue(json({}))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch('/api/write', { method })).rejects.toThrow('Não foi possível preparar a proteção CSRF.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/csrf$/)
  })

  it('includes credentials, decodes CSRF and preserves Headers instances', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/customers', {
      credentials: 'omit', method: 'POST', headers: new Headers({ 'Content-Type': 'application/json' }),
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('X-XSRF-TOKEN')).toBe('token=decoded')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('shares CSRF bootstrap and reads the new cookie before parallel requests', async () => {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/api/csrf')) {
        await Promise.resolve()
        document.cookie = 'XSRF-TOKEN=fresh%3Dtoken; path=/'
        return json({})
      }
      expect(new Headers(init?.headers).get('X-XSRF-TOKEN')).toBe('fresh=token')
      expect(init?.credentials).toBe('include')
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([apiFetch('/api/one', { method: 'POST' }), apiFetch('/api/two', { method: 'PATCH' })])
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/api/csrf'))).toHaveLength(1)
    expect(fetchMock.mock.calls).toHaveLength(3)
  })

  it('does not submit a form when CSRF bootstrap fails, and can retry later', async () => {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
    const fetchMock = vi.fn().mockResolvedValue(json({}, 503))
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitCustomer('João', '11999991234')).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockImplementation(async () => {
      document.cookie = 'XSRF-TOKEN=recovered; path=/'
      return json({ message: 'Solicitação recebida.' })
    })
    await expect(submitCustomer('João', '11999991234')).resolves.toBe('Solicitação recebida.')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('returns only the generic public message and sends a JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      message: 'Solicitação recebida.', id: 42, name: 'Nome privado', phoneNormalized: '11999991234',
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitCustomer('João', '(11) 99999-1234')).resolves.toBe('Solicitação recebida.')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'João', phone: '(11) 99999-1234' })
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Content-Type')).toBe('application/json')
  })

  it('uses the generic fallback if the public response has no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({})))
    await expect(submitCustomer('João', '11999991234')).resolves.toBe('Solicitação recebida.')
  })
})

describe('HTTP errors', () => {
  it.each([
    [401, { message: 'Credenciais inválidas.' }, {}, 'Credenciais inválidas.'],
    [403, { message: 'Acesso permitido apenas para administradores.' }, {}, 'Acesso permitido apenas para administradores.'],
    [403, { code: 'E_BAD_CSRF_TOKEN' }, {}, 'Sessão CSRF expirada. Atualize a página e tente novamente.'],
    [419, {}, {}, 'Sessão CSRF expirada. Atualize a página e tente novamente.'],
    [429, {}, { 'Retry-After': '15' }, 'Muitas tentativas. Tente novamente em 15 segundos.'],
    [429, {}, {}, 'Muitas tentativas. Aguarde antes de tentar novamente.'],
    [422, { errors: { phone: ['Telefone inválido.'] } }, {}, 'Telefone inválido.'],
    [422, { errors: [{ message: 'Nome inválido.' }] }, {}, 'Nome inválido.'],
  ])('preserves status %s and the user-facing error', async (status, payload, headers, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(payload, status as number, headers)))
    await expect(submitCustomer('João', '11999991234')).rejects.toMatchObject({ status, message })
  })

  it('tolerates a non-JSON error without exposing HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Internal failure</h1>', { status: 500 })))
    await expect(submitCustomer('João', '11999991234')).rejects.toMatchObject({
      status: 500, message: 'Não foi possível cadastrar o cliente.',
    })
  })

  it('does not replay a POST after a CSRF failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ code: 'E_BAD_CSRF_TOKEN' }, 403))
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitCustomer('João', '11999991234')).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(isSessionDenied(new ApiError('CSRF', 403, 'E_BAD_CSRF_TOKEN'))).toBe(false)
    expect(isSessionDenied(new ApiError('Sem sessão', 401))).toBe(true)
  })

  it('does not treat a malformed successful response as an admin session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true })))
    await expect(getAdminSession()).rejects.toThrow('Não foi possível confirmar a sessão administrativa.')
  })
})
