import { beforeEach, expect, it, vi } from 'vitest'
import { adjacentDate, canCancel, rangeError } from './adminBooking'
import {
  ApiError,
  CancellationOutcomeUnknownError,
  cancelAdminBooking,
  getAdminBookings,
  isSessionDenied,
} from './api'
import { booking, day, json, list } from '@/test/adminBookingFixtures'
const filters = { from: day, to: day, page: 1, perPage: 50 }
beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=test%3Dtoken; path=/'
})

it('uses Gregorian date arithmetic for leap days, month/year transitions and the 31-day limit', () => {
  expect(adjacentDate('2028-02-28', 1)).toBe('2028-02-29')
  expect(adjacentDate('2028-03-01', -1)).toBe('2028-02-29')
  expect(adjacentDate('2026-12-31', 1)).toBe('2027-01-01')
  expect(adjacentDate('2027-01-01', -1)).toBe('2026-12-31')
  expect(adjacentDate('0001-01-01', -1)).toBeNull()
  expect(adjacentDate('9999-12-31', 1)).toBeNull()
  expect(rangeError('2028-02-29', '2028-03-30')).toBeNull()
  for (const [from, to] of [
    ['2028-02-29', '2028-03-31'],
    ['2026-02-29', '2026-03-01'],
    ['2026-12-28', '2026-12-27'],
  ])
    expect(rangeError(from, to)).toContain('31 dias')
})
it('uses the offset-aware server instant and rejects exact start, ongoing and cancelled records', () => {
  const value = booking()
  const start = Date.parse(value.startsAtLocal)
  expect(canCancel(value, start - 1)).toBe(true)
  expect(canCancel(value, start)).toBe(false)
  expect(canCancel(value, start + 1800000)).toBe(false)
  expect(canCancel(booking(11, 'cancelled'), start - 1)).toBe(false)
})
it('reads an explicitly paginated protected URL with cookies and no CSRF preparation', async () => {
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
  const mock = vi.fn().mockResolvedValue(json(list([booking()])))
  vi.stubGlobal('fetch', mock)
  await expect(getAdminBookings(filters)).resolves.toEqual(list([booking()]))
  expect(mock).toHaveBeenCalledTimes(1)
  const [url, init] = mock.mock.calls[0]
  expect(url).toMatch(/\/api\/admin\/bookings\?from=/)
  expect(
    Object.fromEntries(new URL(url, location.origin).searchParams),
  ).toEqual({ from: day, to: day, page: '1', perPage: '50' })
  expect(init.credentials).toBe('include')
  expect(init.cache).toBe('no-store')
  expect(new Headers(init.headers).has('X-XSRF-TOKEN')).toBe(false)
})
it('prepares shared CSRF and sends only reason; accepts the original server audit on idempotent cancellation', async () => {
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
  const first = booking(11, 'cancelled')
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/csrf')) {
      document.cookie = 'XSRF-TOKEN=fresh%3Dtoken; path=/'
      return json({ ok: true })
    }
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('X-XSRF-TOKEN')).toBe('fresh=token')
    expect(JSON.parse(init?.body as string)).toEqual({ reason: 'Outro motivo' })
    return json({ data: first })
  })
  vi.stubGlobal('fetch', mock)
  const result = await cancelAdminBooking(11, '  Outro motivo  ')
  expect(result.cancellation).toEqual(first.cancellation)
  expect(
    mock.mock.calls.filter(([url]) => url.endsWith('/cancel')),
  ).toHaveLength(1)
})
it.each([401, 403, 404, 409, 422, 429, 503])(
  'preserves HTTP %s without retrying cancellation',
  async (status) => {
    const mock = vi.fn().mockResolvedValue(json({}, status))
    vi.stubGlobal('fetch', mock)
    await expect(cancelAdminBooking(11, 'Motivo')).rejects.toMatchObject({
      status,
    })
    expect(mock).toHaveBeenCalledTimes(1)
  },
)
it('never confuses CSRF denial with loss of administrative permission', () => {
  expect(isSessionDenied(new ApiError('CSRF', 403, 'E_BAD_CSRF_TOKEN'))).toBe(
    false,
  )
  expect(isSessionDenied(new ApiError('Sem permissão', 403))).toBe(true)
  expect(isSessionDenied(new ApiError('Sessão expirada', 401))).toBe(true)
})
it.each([
  { data: {}, meta: {} },
  {
    data: [booking()],
    meta: { page: 1, perPage: 1000, total: 1, lastPage: 1 },
  },
  { data: [booking()], meta: { page: 1, perPage: 50, total: 1, lastPage: 7 } },
])(
  'rejects an unexpected list contract instead of displaying private garbage',
  async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(payload)))
    await expect(getAdminBookings(filters)).rejects.toThrow(
      'Resposta de reservas inválida',
    )
  },
)
it.each(['network', 'wrong-id', 'confirmed', 'malformed'])(
  'requires reconciliation after %s cancellation outcome without retry',
  async (mode) => {
    const mock = vi
      .fn()
      .mockImplementation(() =>
        mode === 'network'
          ? Promise.reject(new TypeError('Offline'))
          : Promise.resolve(
              json({
                data:
                  mode === 'malformed'
                    ? {}
                    : booking(
                        mode === 'wrong-id' ? 99 : 11,
                        mode === 'confirmed' ? 'confirmed' : 'cancelled',
                      ),
              }),
            ),
      )
    vi.stubGlobal('fetch', mock)
    await expect(cancelAdminBooking(11, 'Motivo')).rejects.toBeInstanceOf(
      CancellationOutcomeUnknownError,
    )
    expect(mock).toHaveBeenCalledTimes(1)
  },
)
