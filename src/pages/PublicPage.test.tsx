import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '@/App'
import {
  availability,
  confirmation,
  date,
  deferred,
  json,
  service,
} from '@/test/bookingFixtures'

function mockApi(
  handler?: (
    url: URL,
    init?: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  const mock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, window.location.origin)
    const custom = handler?.(url, init)
    if (custom) return custom
    if (url.pathname === '/api/services') return json({ data: [service] })
    if (url.pathname === '/api/availability')
      return json({ data: availability(url.searchParams.get('date')!) })
    if (url.pathname === '/api/csrf') {
      document.cookie = 'XSRF-TOKEN=fresh; path=/'
      return json({ ok: true })
    }
    if (url.pathname === '/api/bookings')
      return json({ data: confirmation }, 201)
    throw new Error(`Unexpected API call: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}
function open() {
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  )
}
const continueStep = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
async function chooseDate(value = date) {
  fireEvent.click(await screen.findByRole('radio', { name: /Corte clássico/ }))
  continueStep()
  fireEvent.change(screen.getByLabelText('Data do atendimento'), {
    target: { value },
  })
  continueStep()
}
async function details() {
  await chooseDate()
  fireEvent.click(await screen.findByRole('radio', { name: '09:00' }))
  continueStep()
}
async function review() {
  await details()
  fireEvent.change(screen.getByLabelText('Nome completo'), {
    target: { value: 'Cliente Exemplo' },
  })
  fireEvent.change(screen.getByLabelText('Telefone'), {
    target: { value: '(71) 99999-9999' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Revisar agendamento' }))
}
const postCount = (mock: ReturnType<typeof mockApi>) =>
  mock.mock.calls.filter(([url]) => url.endsWith('/api/bookings')).length
beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=test-token; path=/'
})
afterEach(() => {
  vi.useRealTimers()
})

it('loads services, displays description/BRL price, and selects a single service accessibly', async () => {
  const pending = deferred<Response>()
  mockApi((url) =>
    url.pathname === '/api/services' ? pending.promise : undefined,
  )
  open()
  expect(screen.getByRole('status').textContent).toContain(
    'Carregando serviços',
  )
  await act(async () => pending.resolve(json({ data: [service] })))
  const radio = await screen.findByRole('radio', { name: /Corte clássico/ })
  expect(screen.getByText('Acabamento com cuidado.')).toBeTruthy()
  expect(screen.getByText(/45,00/)).toBeTruthy()
  fireEvent.click(radio)
  expect((radio as HTMLInputElement).checked).toBe(true)
  continueStep()
  expect(screen.getByLabelText('Data do atendimento')).toBeTruthy()
  expect(
    screen.getByRole('button', { name: /Serviço, etapa concluída/ }),
  ).toBeTruthy()
})

it.each(['empty', 'error'])(
  'handles %s catalogue without blocking navigation',
  async (mode) => {
    mockApi((url) =>
      url.pathname === '/api/services'
        ? mode === 'empty'
          ? json({ data: [] })
          : json({}, 503)
        : undefined,
    )
    open()
    if (mode === 'empty') await screen.findByText(/Nenhum serviço disponível/)
    else await screen.findByRole('alert')
    expect(
      (screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Atualizar serviços' }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Gestão' })).toBeTruthy()
  },
)

it('uses the chosen local date in GET and renders only returned slots, including an empty day', async () => {
  let empty = false
  const mock = mockApi((url) =>
    url.pathname === '/api/availability'
      ? json({ data: availability(date, empty ? [] : [660]) })
      : undefined,
  )
  open()
  await chooseDate()
  await screen.findByRole('radio', { name: '11:00' })
  expect(screen.queryByRole('radio', { name: '09:00' })).toBeNull()
  expect(
    mock.mock.calls.some(([url]) =>
      url.endsWith(`/api/availability?date=${date}`),
    ),
  ).toBe(true)
  empty = true
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar horários' }))
  await screen.findByText(/Não há horários disponíveis/)
})

it('rejects a past local date even if native browser validation is bypassed', async () => {
  const mock = mockApi()
  open()
  fireEvent.click(await screen.findByRole('radio', { name: /Corte clássico/ }))
  continueStep()
  const dateInput = screen.getByLabelText('Data do atendimento')
  expect(dateInput.getAttribute('min')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  fireEvent.change(dateInput, { target: { value: '2000-01-01' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Agendamento público' }))
  expect((await screen.findByRole('alert')).textContent).toContain(
    'data válida',
  )
  expect(
    mock.mock.calls.some(([url]) => url.includes('/api/availability')),
  ).toBe(false)
})

it('ignores an old availability response after rapid date changes even if fetch ignores abort', async () => {
  const stale = deferred<Response>()
  mockApi((url) =>
    url.pathname === '/api/availability' &&
    url.searchParams.get('date') === date
      ? stale.promise
      : undefined,
  )
  open()
  await chooseDate()
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  fireEvent.change(screen.getByLabelText('Data do atendimento'), {
    target: { value: '2099-12-29' },
  })
  continueStep()
  await screen.findByRole('radio', { name: '09:00' })
  await act(async () =>
    stale.resolve(json({ data: availability(date, [660]) })),
  )
  expect(screen.getByText('Horários em 29/12/2099 · São Paulo')).toBeTruthy()
  expect(screen.queryByRole('radio', { name: '11:00' })).toBeNull()
})

it('validates contact, preserves it when going back and shows a full review without storing personal data', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  mockApi()
  open()
  await details()
  fireEvent.change(screen.getByLabelText('Nome completo'), {
    target: { value: ' ' },
  })
  fireEvent.submit(screen.getByRole('form', { name: 'Agendamento público' }))
  expect(screen.getByRole('alert').textContent).toContain('nome')
  fireEvent.change(screen.getByLabelText('Nome completo'), {
    target: { value: 'Cliente Exemplo' },
  })
  fireEvent.change(screen.getByLabelText('Telefone'), {
    target: { value: 'abc123' },
  })
  fireEvent.submit(screen.getByRole('form', { name: 'Agendamento público' }))
  expect(screen.getByRole('alert').textContent).toContain('telefone válido')
  fireEvent.change(screen.getByLabelText('Telefone'), {
    target: { value: '71999999999' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Revisar agendamento' }))
  for (const text of [
    'Cliente Exemplo',
    '71999999999',
    '28/12/2099',
    '09:00',
    '60 minutos',
  ])
    expect(screen.getByText(text)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  expect(
    (screen.getByLabelText('Nome completo') as HTMLInputElement).value,
  ).toBe('Cliente Exemplo')
  expect(storage).not.toHaveBeenCalled()
})

it('sends the exact booking payload with CSRF/cookies once and uses only server data for the 201 confirmation', async () => {
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
  const pending = deferred<Response>()
  const mock = mockApi((url) =>
    url.pathname === '/api/bookings' ? pending.promise : undefined,
  )
  open()
  await review()
  const button = screen.getByRole('button', { name: 'Confirmar agendamento' })
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => expect(postCount(mock)).toBe(1))
  const [, init] = mock.mock.calls.find(([url]) =>
    url.endsWith('/api/bookings'),
  )!
  expect(init?.credentials).toBe('include')
  expect(new Headers(init?.headers).get('X-XSRF-TOKEN')).toBe('fresh')
  expect(JSON.parse(init?.body as string)).toEqual({
    serviceId: 7,
    localDate: date,
    startsAtMinute: 540,
    name: 'Cliente Exemplo',
    phone: '(71) 99999-9999',
  })
  expect(mock.mock.calls.some(([url]) => url.endsWith('/api/customers'))).toBe(
    false,
  )
  expect(
    (screen.getByRole('button', { name: 'Confirmando…' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  await act(async () => pending.resolve(json({ data: confirmation }, 201)))
  await screen.findByRole('heading', { name: 'Agendamento confirmado' })
  expect(screen.getByText('#321')).toBeTruthy()
  expect(screen.getByText('Corte confirmado pelo servidor')).toBeTruthy()
  expect(screen.getByText(/50,00/)).toBeTruthy()
  expect(screen.queryByText('Cliente Exemplo')).toBeNull()
  expect(postCount(mock)).toBe(1)
})

it('409 invalidates the slot, preserves contact, and refreshes availability only on explicit request', async () => {
  const mock = mockApi((url) =>
    url.pathname === '/api/bookings' ? json({}, 409) : undefined,
  )
  open()
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
  expect((await screen.findByRole('alert')).textContent).toContain(
    'indisponível',
  )
  expect(screen.queryByRole('radio', { name: '09:00' })).toBeNull()
  expect(
    mock.mock.calls.filter(([url]) => url.includes('/api/availability')).length,
  ).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar horários' }))
  fireEvent.click(await screen.findByRole('radio', { name: '10:00' }))
  continueStep()
  expect(
    (screen.getByLabelText('Nome completo') as HTMLInputElement).value,
  ).toBe('Cliente Exemplo')
  expect((screen.getByLabelText('Telefone') as HTMLInputElement).value).toBe(
    '(71) 99999-9999',
  )
  expect(postCount(mock)).toBe(1)
})

it.each([422, 503, 403, 419])(
  'handles HTTP %s without claiming success or automatically repeating POST',
  async (status) => {
    const mock = mockApi((url) =>
      url.pathname === '/api/bookings'
        ? json(status === 403 ? { code: 'E_BAD_CSRF_TOKEN' } : {}, status)
        : undefined,
    )
    open()
    await review()
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar agendamento' }),
    )
    await screen.findByRole('alert')
    expect(
      screen.queryByRole('heading', { name: 'Agendamento confirmado' }),
    ).toBeNull()
    expect(postCount(mock)).toBe(1)
    if (status === 422)
      expect(
        screen.getByRole('button', { name: 'Atualizar serviços' }),
      ).toBeTruthy()
  },
)

it('respects Retry-After by disabling manual POST until its deadline', async () => {
  const mock = mockApi((url) =>
    url.pathname === '/api/bookings'
      ? json({}, 429, { 'Retry-After': '2' })
      : undefined,
  )
  open()
  await review()
  vi.useFakeTimers()
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar agendamento' }),
    )
  })
  expect(
    (
      screen.getByRole('button', {
        name: /Aguarde 2s para confirmar/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500)
  })
  expect(
    (
      screen.getByRole('button', {
        name: 'Confirmar agendamento',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false)
  expect(postCount(mock)).toBe(1)
})

it.each(['services', 'availability'])(
  'respects the independent %s GET rate budget',
  async (resource) => {
    mockApi((url) =>
      url.pathname === `/api/${resource}`
        ? json({}, 429, { 'Retry-After': '15' })
        : undefined,
    )
    open()
    if (resource === 'availability') await chooseDate()
    await screen.findByRole('alert')
    const button = await screen.findByRole('button', {
      name:
        resource === 'services'
          ? /Aguarde 15s para atualizar serviços/
          : /Aguarde 15s para atualizar horários/,
    })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  },
)

it.each(['network', 'timeout', 'malformed'])(
  'treats %s as uncertain and never retries a possibly confirmed booking',
  async (mode) => {
    const mock = mockApi((url, init) => {
      if (url.pathname !== '/api/bookings') return
      if (mode === 'network') return Promise.reject(new TypeError('Offline'))
      if (mode === 'malformed') return json({ data: { id: 123 } }, 201)
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Timeout', 'AbortError')),
          { once: true },
        ),
      )
    })
    open()
    await review()
    if (mode === 'timeout') vi.useFakeTimers()
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar agendamento' }),
    )
    if (mode === 'timeout') {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20001)
      })
      vi.useRealTimers()
    }
    await screen.findByRole('heading', { name: 'Confirmação não recebida' })
    expect(screen.getByRole('alert').textContent).toContain(
      'pode ter sido criada',
    )
    expect(
      screen.queryByRole('button', { name: 'Confirmar agendamento' }),
    ).toBeNull()
    expect(postCount(mock)).toBe(1)
  },
)

it('aborts reads on unmount without applying stale results', async () => {
  const pending = deferred<Response>()
  const mock = mockApi((url) =>
    url.pathname === '/api/services' ? pending.promise : undefined,
  )
  const view = open()
  const signal = mock.mock.calls[0][1]?.signal
  view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => pending.resolve(json({ data: [service] })))
  expect(screen.queryByText('Corte clássico')).toBeNull()
})
