import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError, ServiceOutcomeUnknownError, getAdminServices, saveAdminService } from './api'
import { json } from '@/test/adminBookingFixtures'
const service = {
  id: 1,
  name: 'Corte',
  description: null,
  priceCents: 4500,
  durationMinutes: 45,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: null,
}
beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=token; path=/'
})
afterEach(() => vi.unstubAllGlobals())
it('GETs with session cookies, no CSRF and no-store', async () => {
  const fetch = vi.fn().mockResolvedValue(json({ data: [service] }))
  vi.stubGlobal('fetch', fetch)
  expect(await getAdminServices()).toEqual([service])
  const init = fetch.mock.calls[0][1]
  expect(init.credentials).toBe('include')
  expect(init.cache).toBe('no-store')
  expect(new Headers(init.headers).has('X-XSRF-TOKEN')).toBe(false)
})
it.each([
  { data: {} },
  { data: [{ ...service, priceCents: '4500' }] },
  { data: [service, service] },
])('rejects unexpected read payload %j', async (data) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(data)))
  await expect(getAdminServices()).rejects.toThrow('Resposta de serviços inválida')
})
it('PATCH allowlists input and preserves explicit null and false', async () => {
  const fetch = vi.fn().mockResolvedValue(json({ data: service }))
  vi.stubGlobal('fetch', fetch)
  const input = { description: null, isActive: false, id: 99, createdAt: 'fake', role: 'admin' }
  await saveAdminService(1, input)
  const init = fetch.mock.calls[0][1]
  expect(JSON.parse(init.body)).toEqual({ description: null, isActive: false })
  expect(init.method).toBe('PATCH')
  expect(init.credentials).toBe('include')
  expect(new Headers(init.headers).get('X-XSRF-TOKEN')).toBe('token')
})
it('missing CSRF token prevents dispatch entirely', async () => {
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
  const fetch = vi.fn().mockResolvedValue(json({}))
  vi.stubGlobal('fetch', fetch)
  await expect(saveAdminService(null, { name: 'Corte' })).rejects.toThrow(
    'Nenhum serviço foi enviado',
  )
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toContain('/api/csrf')
})
it.each([200, 201])(
  'treats malformed write response %s as uncertain without retry',
  async (status) => {
    const fetch = vi.fn().mockResolvedValue(json({}, status))
    vi.stubGlobal('fetch', fetch)
    await expect(saveAdminService(null, { name: 'Corte' })).rejects.toBeInstanceOf(
      ServiceOutcomeUnknownError,
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  },
)
it('keeps HTTP validation failures distinct from transport uncertainty', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ message: 'Inválido' }, 422)))
  await expect(saveAdminService(null, { name: 'Corte' })).rejects.toBeInstanceOf(ApiError)
})
