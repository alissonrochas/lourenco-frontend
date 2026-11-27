import { beforeEach, expect, it, vi } from 'vitest'
import { readBookingPolicy, dateWithinPolicy } from './booking'
import {
  ApiError,
  BookingDateOutOfRangeError,
  PublicBookingNotAcceptedError,
  createPublicBooking,
  getPublicAvailability,
} from './api'
import { availability, date, json, policy } from '@/test/bookingFixtures'

beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=test-token; path=/'
})
it.each([
  ['2026-11-10', '2026-12-10'],
  ['2026-12-20', '2027-01-19'],
  ['2028-01-30', '2028-02-29'],
  ['2028-02-29', '2028-03-30'],
])(
  'accepts server calendar bounds %s–%s inclusively without computing a new horizon',
  (minDate, maxDate) => {
    const p = readBookingPolicy({
      minDate,
      maxDate,
      timezone: 'America/Sao_Paulo',
      extra: 'not retained',
    })!
    expect(p).toEqual({ minDate, maxDate, timezone: 'America/Sao_Paulo' })
    expect(dateWithinPolicy(minDate, p)).toBe(true)
    expect(dateWithinPolicy(maxDate, p)).toBe(true)
  },
)
it.each([
  null,
  [],
  {},
  { ...policy, minDate: '2026-02-29' },
  { ...policy, maxDate: '1900-02-29' },
  { ...policy, minDate: '2099-12-32' },
  { ...policy, maxDate: '2099-12-00' },
  { ...policy, minDate: '2099-12-31', maxDate: '2099-12-01' },
  { ...policy, timezone: 'UTC' },
  { ...policy, minDate: 20261201 },
  { ...policy, maxDate: ['2099-12-31'] },
  { ...policy, minDate: '2099-12-01T00:00:00Z' },
  { ...policy, minDate: '0000-01-01' },
])('rejects malformed policy %j', (value) => {
  expect(readBookingPolicy(value)).toBeNull()
})
it('rejects successful availability missing policy or outside its returned bounds', async () => {
  for (const data of [
    { ...availability(), policy: undefined },
    { ...availability(), policy: { ...policy, maxDate: '2099-12-27' } },
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data })))
    await expect(getPublicAvailability(date)).rejects.toThrow(
      'Resposta de horários inválida',
    )
  }
})
it('validates horizon errors and retains only public date limits', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        json(
          {
            code: 'BOOKING_DATE_OUT_OF_RANGE',
            message: 'Date outside.',
            policy: { ...policy, private: 'ignore' },
            customer: 'ignore',
          },
          422,
        ),
      ),
  )
  await expect(getPublicAvailability('2000-01-01')).rejects.toMatchObject({
    status: 422,
    code: 'BOOKING_DATE_OUT_OF_RANGE',
    policy,
  })
})
it.each([
  { code: 'BOOKING_DATE_OUT_OF_RANGE', message: 'Outside', policy: null },
  { code: 'BOOKING_DATE_OUT_OF_RANGE', message: {}, policy },
  {
    code: 'BOOKING_DATE_OUT_OF_RANGE',
    message: 'Outside',
    policy: { ...policy, minDate: '2000-01-01' },
  }, // contradicts requested date
])(
  'does not adopt malformed or contradictory horizon error %j',
  async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(payload, 422)))
    try {
      await getPublicAvailability('2000-01-01')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect(error).not.toBeInstanceOf(BookingDateOutOfRangeError)
      expect((error as ApiError).code).toBe('INVALID_BOOKING_POLICY')
    }
  },
)
it('does not invent a 30-day window or rely on the device date', () => {
  const p = readBookingPolicy({
    minDate: '2028-02-01',
    maxDate: '2028-04-01',
    timezone: 'America/Sao_Paulo',
  })!
  expect(dateWithinPolicy('2028-02-29', p)).toBe(true)
  expect(dateWithinPolicy('2028-04-02', p)).toBe(false)
  expect(dateWithinPolicy('2028-01-31', p)).toBe(false)
})
it('treats a valid quota refusal as definite and never retains private details or arbitrary messages', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        json(
          {
            code: 'PUBLIC_BOOKING_NOT_ACCEPTED',
            message: 'Private name, contact and existing appointments',
            reservations: [{ id: 999, phone: 'private' }],
          },
          422,
        ),
      ),
  )
  const input = {
    serviceId: 7,
    localDate: date,
    startsAtMinute: 540,
    name: 'Synthetic',
    phone: '71999999999',
  }
  try {
    await createPublicBooking(input)
    expect.unreachable()
  } catch (error) {
    expect(error).toBeInstanceOf(PublicBookingNotAcceptedError)
    expect((error as Error).message).toBe(
      'Não foi possível concluir a reserva pelo site. Entre em contato com a barbearia.',
    )
    expect(JSON.stringify(error)).not.toContain('private')
  }
})
it('keeps malformed quota errors as definite HTTP failures, not a valid quota signal or an unknown write', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        json({ code: 'PUBLIC_BOOKING_NOT_ACCEPTED', message: null }, 422),
      ),
  )
  try {
    await createPublicBooking({
      serviceId: 7,
      localDate: date,
      startsAtMinute: 540,
      name: 'Synthetic',
      phone: '71999999999',
    })
    expect.unreachable()
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    expect(error).not.toBeInstanceOf(PublicBookingNotAcceptedError)
    expect((error as ApiError).code).toBe('INVALID_BOOKING_RESPONSE')
  }
})
