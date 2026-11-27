import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PublicPage } from './PublicPage'
import {
  availability,
  confirmation,
  deferred,
  json,
  service,
} from '@/test/bookingFixtures'
import { dateWithinPolicy, formatTime, type BookingPolicy } from '@/lib/booking'

let policy: BookingPolicy
let custom:
  | ((url: URL, init?: RequestInit) => Response | Promise<Response> | undefined)
  | undefined
let fetchMock: ReturnType<typeof vi.fn>
const chosen = '2026-12-28'
function outside() {
  return json(
    {
      code: 'BOOKING_DATE_OUT_OF_RANGE',
      message: 'Escolha outra data.',
      policy,
    },
    422,
  )
}
function result(date: string, starts = [540, 600]) {
  return { ...availability(date, starts), policy: { ...policy } }
}
const continueStep = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
const count = (path: string) =>
  fetchMock.mock.calls.filter(
    ([input]) => new URL(input, location.origin).pathname === path,
  ).length
async function selectDay(date = chosen) {
  fireEvent.click(await screen.findByRole('radio', { name: /Corte clássico/ }))
  continueStep()
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Data do atendimento') as HTMLInputElement)
        .disabled,
    ).toBe(false),
  )
  fireEvent.change(screen.getByLabelText('Data do atendimento'), {
    target: { value: date },
  })
  continueStep()
}
async function review(date = chosen, time = '09:00') {
  await selectDay(date)
  fireEvent.click(await screen.findByRole('radio', { name: time }))
  continueStep()
  fireEvent.change(screen.getByLabelText('Nome completo'), {
    target: { value: 'Cliente Exemplo' },
  })
  fireEvent.change(screen.getByLabelText('Telefone'), {
    target: { value: '71999999999' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Revisar agendamento' }))
}
async function fillAgain(date = '2026-12-29') {
  fireEvent.change(screen.getByLabelText('Data do atendimento'), {
    target: { value: date },
  })
  continueStep()
  fireEvent.click(await screen.findByRole('radio', { name: '09:00' }))
  continueStep()
  expect(
    (screen.getByLabelText('Nome completo') as HTMLInputElement).value,
  ).toBe('Cliente Exemplo')
  expect((screen.getByLabelText('Telefone') as HTMLInputElement).value).toBe(
    '71999999999',
  )
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-01T12:00:00Z'))
  document.cookie = 'XSRF-TOKEN=synthetic-token; path=/'
  policy = {
    minDate: '2026-12-01',
    maxDate: '2026-12-31',
    timezone: 'America/Sao_Paulo',
  }
  custom = undefined
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, location.origin)
    const response = custom?.(url, init)
    if (response) return response
    if (url.pathname === '/api/services') return json({ data: [service] })
    if (url.pathname === '/api/availability') {
      const date = url.searchParams.get('date')!
      return dateWithinPolicy(date, policy)
        ? json({ data: result(date) })
        : outside()
    }
    if (url.pathname === '/api/bookings') {
      const data = JSON.parse(init!.body as string)
      return json(
        {
          data: {
            ...confirmation,
            localDate: data.localDate,
            startsAtMinute: data.startsAtMinute,
            startsAtLocal: `${data.localDate}T${formatTime(data.startsAtMinute)}:00-03:00`,
            endsAtLocal: `${data.localDate}T${formatTime(data.startsAtMinute + 60)}:00-03:00`,
          },
        },
        201,
      )
    }
    throw new Error(`Unexpected ${url.pathname}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.useRealTimers())

it('discovers only on entry, applies first/last bounds and blocks both outside dates beyond HTML validation', async () => {
  render(<PublicPage />)
  await screen.findByRole('radio', { name: /Corte clássico/ })
  expect(count('/api/availability')).toBe(0)
  fireEvent.click(screen.getByRole('radio', { name: /Corte clássico/ }))
  continueStep()
  const input = screen.getByLabelText('Data do atendimento') as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  expect(input.min).toBe(policy.minDate)
  expect(input.max).toBe(policy.maxDate)
  expect(count('/api/availability')).toBe(1)
  for (const invalid of ['2026-11-30', '2027-01-01']) {
    fireEvent.change(input, { target: { value: invalid } })
    fireEvent.submit(screen.getByRole('form'))
    await screen.findByRole('alert')
    expect(count('/api/availability')).toBe(1)
  }
  for (const valid of [policy.minDate, policy.maxDate]) {
    fireEvent.change(screen.getByLabelText('Data do atendimento'), {
      target: { value: valid },
    })
    continueStep()
    await screen.findByRole('radio', { name: '09:00' })
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  }
  expect(count('/api/availability')).toBe(3)
  expect(count('/api/bookings')).toBe(0)
})
it('uses a validated horizon error for initial discovery even when the device date is years wrong', async () => {
  vi.setSystemTime(new Date('2099-01-01T12:00:00Z'))
  render(<PublicPage />)
  await review()
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).includes('date=2099-01-01'),
    ),
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
  await screen.findByRole('heading', { name: 'Agendamento confirmado' })
  expect(count('/api/bookings')).toBe(1)
})
it('fails closed on malformed discovery and accepts a valid manual refresh without resetting service', async () => {
  let broken = true
  custom = (url) =>
    url.pathname === '/api/availability' && broken
      ? json({
          data: {
            ...result(policy.minDate),
            policy: { ...policy, maxDate: '2026-02-29' },
          },
        })
      : undefined
  render(<PublicPage />)
  fireEvent.click(await screen.findByRole('radio', { name: /Corte clássico/ }))
  continueStep()
  await screen.findByRole('alert')
  expect(
    (screen.getByLabelText('Data do atendimento') as HTMLInputElement).disabled,
  ).toBe(true)
  expect(
    (screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  broken = false
  fireEvent.click(
    screen.getByRole('button', { name: 'Atualizar limites de datas' }),
  )
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Data do atendimento') as HTMLInputElement).max,
    ).toBe('2026-12-31'),
  )
  expect(count('/api/services')).toBe(1)
})
it('updates the open form at Sao Paulo midnight on resume and preserves contact and service', async () => {
  render(<PublicPage />)
  await review('2026-12-01', '10:00')
  policy = { ...policy, minDate: '2026-12-02', maxDate: '2027-01-01' }
  vi.setSystemTime(new Date('2026-12-02T03:00:00Z'))
  fireEvent.focus(window)
  await screen.findByLabelText('Data do atendimento')
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Data do atendimento') as HTMLInputElement).min,
    ).toBe('2026-12-02'),
  )
  expect(screen.getByRole('alert').textContent).toContain(
    'Seus dados foram mantidos',
  )
  expect(count('/api/bookings')).toBe(0)
  await fillAgain('2026-12-02')
  expect(count('/api/services')).toBe(1)
})
it('revalidates with the server before POST even if a wrong device clock does not advance', async () => {
  render(<PublicPage />)
  await review('2026-12-01', '10:00')
  policy = { ...policy, minDate: '2026-12-02', maxDate: '2027-01-01' }
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
  await screen.findByLabelText('Data do atendimento')
  expect(
    (screen.getByLabelText('Data do atendimento') as HTMLInputElement).min,
  ).toBe('2026-12-02')
  expect(count('/api/bookings')).toBe(0)
  await fillAgain('2026-12-02')
})
it('handles a POST horizon race, updates bounds and preserves every field for a new date', async () => {
  custom = (url) => {
    if (url.pathname !== '/api/bookings') return
    policy = { ...policy, minDate: '2026-12-29', maxDate: '2027-01-28' }
    return outside()
  }
  render(<PublicPage />)
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
  await screen.findByLabelText('Data do atendimento')
  expect(
    (screen.getByLabelText('Data do atendimento') as HTMLInputElement).value,
  ).toBe(chosen)
  expect(
    (screen.getByLabelText('Data do atendimento') as HTMLInputElement).max,
  ).toBe('2027-01-28')
  await fillAgain()
  expect(count('/api/bookings')).toBe(1)
})
it('keeps a quota refusal on review with generic feedback, no private details, no automatic retry and no uncertain outcome', async () => {
  custom = (url) =>
    url.pathname === '/api/bookings'
      ? json(
          {
            code: 'PUBLIC_BOOKING_NOT_ACCEPTED',
            message: 'Private THIRD_PARTY_DETAILS',
            reservations: [{ phone: 'private', id: 999 }],
          },
          422,
        )
      : undefined
  render(<PublicPage />)
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toBe(
    'Não foi possível concluir a reserva pelo site. Entre em contato com a barbearia.',
  )
  expect(document.body.textContent).not.toContain('THIRD_PARTY_DETAILS')
  for (const text of [
    'Cliente Exemplo',
    '71999999999',
    '28/12/2026',
    'Corte clássico',
  ])
    expect(screen.getByText(text)).toBeTruthy()
  const confirm = screen.getByRole('button', {
    name: 'Confirmar agendamento',
  }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(count('/api/bookings')).toBe(1)
  expect(screen.queryByText('Confirmação não recebida')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  expect((screen.getByLabelText('Telefone') as HTMLInputElement).value).toBe(
    '71999999999',
  )
})
it('a failed read before POST is definite non-submission and only an explicit retry sends a write', async () => {
  let reads = 0
  custom = (url) =>
    url.pathname === '/api/availability' &&
    url.searchParams.get('date') === chosen &&
    ++reads === 2
      ? Promise.reject(new TypeError('Offline before sending'))
      : undefined
  render(<PublicPage />)
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
  await screen.findByRole('alert')
  expect(count('/api/bookings')).toBe(0)
  expect(screen.queryByText('Confirmação não recebida')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
  await screen.findByRole('heading', { name: 'Agendamento confirmado' })
  expect(count('/api/bookings')).toBe(1)
})
it('invalidates a slot that disappeared during review without sending any POST', async () => {
  let reads = 0
  custom = (url) =>
    url.pathname === '/api/availability' &&
    url.searchParams.get('date') === chosen &&
    ++reads === 2
      ? json({ data: result(chosen, []) })
      : undefined
  render(<PublicPage />)
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
  await screen.findByRole('alert')
  expect(
    screen.getByRole('button', { name: 'Atualizar horários' }),
  ).toBeTruthy()
  expect(count('/api/bookings')).toBe(0)
})
it('ignores an older response and its older policy after rapid changes', async () => {
  const stale = deferred<Response>()
  custom = (url) =>
    url.pathname === '/api/availability' &&
    url.searchParams.get('date') === chosen
      ? stale.promise
      : undefined
  render(<PublicPage />)
  await selectDay()
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  policy = { ...policy, minDate: '2026-12-02', maxDate: '2027-01-01' }
  fireEvent.change(screen.getByLabelText('Data do atendimento'), {
    target: { value: '2026-12-29' },
  })
  continueStep()
  await screen.findByRole('radio', { name: '09:00' })
  await act(async () =>
    stale.resolve(
      json({
        data: {
          ...result(chosen, [660]),
          policy: {
            minDate: '2026-12-01',
            maxDate: '2026-12-31',
            timezone: 'America/Sao_Paulo',
          },
        },
      }),
    ),
  )
  expect(screen.queryByRole('radio', { name: '11:00' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  expect(
    (screen.getByLabelText('Data do atendimento') as HTMLInputElement).min,
  ).toBe('2026-12-02')
})

it('performs local minute checks without server polling and refreshes once when Sao Paulo day changes', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-12-01T12:00:00Z'))
  render(<PublicPage />)
  await review('2026-12-01', '10:00')
  const before = count('/api/availability')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180_000)
  })
  expect(count('/api/availability')).toBe(before)
  policy = { ...policy, minDate: '2026-12-02', maxDate: '2027-01-01' }
  vi.setSystemTime(new Date('2026-12-02T03:00:00Z'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(
    (screen.getByLabelText('Data do atendimento') as HTMLInputElement).min,
  ).toBe('2026-12-02')
  expect(count('/api/availability')).toBe(before + 1)
  expect(count('/api/bookings')).toBe(0)
})
it('bounds a hung read before POST and never calls it an unknown booking outcome', async () => {
  let reads = 0
  custom = (url, init) =>
    url.pathname === '/api/availability' &&
    url.searchParams.get('date') === chosen &&
    ++reads === 2
      ? new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timeout', 'AbortError')),
            { once: true },
          ),
        )
      : undefined
  render(<PublicPage />)
  await review()
  vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20001)
  })
  expect(screen.getByRole('alert').textContent).toContain(
    'Nenhuma reserva foi enviada',
  )
  expect(count('/api/bookings')).toBe(0)
  expect(screen.queryByText('Confirmação não recebida')).toBeNull()
})
