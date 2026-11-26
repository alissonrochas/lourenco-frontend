import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import App from '@/App'
import {
  admin,
  booking,
  day,
  deferred,
  json,
  list,
} from '@/test/adminBookingFixtures'
import { adjacentDate } from '@/lib/adminBooking'

type Handler = (
  url: URL,
  init?: RequestInit,
) => Response | Promise<Response> | undefined
function mockApi(handler?: Handler) {
  const mock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, window.location.origin)
    const custom = handler?.(url, init)
    if (custom) return custom
    if (url.pathname === '/api/admin/me') return json({ user: admin })
    if (url.pathname === '/api/admin/bookings') return json(list([booking()]))
    if (url.pathname.endsWith('/cancel'))
      return json({ data: booking(11, 'cancelled') })
    if (url.pathname === '/api/admin/logout') return json({ ok: true })
    if (url.pathname === '/api/admin/login') return json({ user: admin })
    if (url.pathname === '/api/csrf') {
      document.cookie = 'XSRF-TOKEN=fresh-token; path=/'
      return json({ ok: true })
    }
    throw new Error(`Unexpected endpoint ${url.pathname}`)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}
function open() {
  window.history.replaceState(null, '', '/admin')
  return render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  )
}
async function showDialog() {
  const trigger = await screen.findByRole('button', {
    name: 'Cancelar reserva #11',
  })
  trigger.focus()
  fireEvent.click(trigger)
  return screen.getByRole('dialog')
}
function reason(value = 'Solicitado pelo cliente') {
  fireEvent.change(screen.getByLabelText('Motivo do cancelamento'), {
    target: { value },
  })
}
function confirm() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirmar cancelamento' }),
  )
}
const cancelCalls = (mock: ReturnType<typeof mockApi>) =>
  mock.mock.calls.filter(([url]) => url.endsWith('/cancel'))
const readCalls = (mock: ReturnType<typeof mockApi>) =>
  mock.mock.calls.filter(
    ([url]) =>
      new URL(url, window.location.origin).pathname === '/api/admin/bookings',
  )
beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=test%3Dtoken; path=/'
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(`${day}T12:00:00-03:00`))
})
afterEach(() => vi.useRealTimers())

it('waits for session confirmation before requesting or rendering private records', async () => {
  const pending = deferred<Response>()
  const mock = mockApi((url) =>
    url.pathname === '/api/admin/me' ? pending.promise : undefined,
  )
  open()
  expect(readCalls(mock)).toHaveLength(0)
  expect(screen.queryByText('Cliente privado 11')).toBeNull()
  await act(async () => pending.resolve(json({ user: admin })))
  await screen.findByText('Cliente privado 11')
  const url = new URL(readCalls(mock)[0][0], window.location.origin)
  expect(Object.fromEntries(url.searchParams)).toEqual({
    from: day,
    to: day,
    page: '1',
    perPage: '50',
  })
})

it.each([401, 403])(
  'denies initial session %s without reading or exposing reservations',
  async (status) => {
    const mock = mockApi((url) =>
      url.pathname === '/api/admin/me'
        ? json({ message: 'Acesso negado.' }, status)
        : undefined,
    )
    open()
    await screen.findByRole('heading', { name: 'Login do administrador' })
    expect(readCalls(mock)).toHaveLength(0)
    expect(screen.queryByText('Cliente privado 11')).toBeNull()
  },
)

it('loads the agenda after login and displays an empty result without invented metrics', async () => {
  let authenticated = false
  mockApi((url) => {
    if (url.pathname === '/api/admin/me')
      return json(
        authenticated ? { user: admin } : {},
        authenticated ? 200 : 401,
      )
    if (url.pathname === '/api/admin/login') {
      authenticated = true
      return json({ user: admin })
    }
    if (url.pathname === '/api/admin/bookings') return json(list([]))
  })
  open()
  await screen.findByRole('heading', { name: 'Login do administrador' })
  fireEvent.change(screen.getByLabelText('E-mail'), {
    target: { value: 'admin@example.test' },
  })
  fireEvent.change(screen.getByLabelText('Senha'), {
    target: { value: 'Password123' },
  })
  fireEvent.submit(screen.getByRole('form', { name: 'Login do administrador' }))
  await screen.findByText('Nenhuma reserva nesta página do período consultado.')
  expect(screen.getByText(/0 reservas no período/)).toBeTruthy()
  expect(screen.queryByText(/faturamento|comparecimento/i)).toBeNull()
})

it('preserves API ordering, historical price and cancelled audit alongside customer contact', async () => {
  mockApi((url) =>
    url.pathname === '/api/admin/bookings'
      ? json(list([booking(12, 'cancelled'), booking()]))
      : undefined,
  )
  open()
  await screen.findByText('Cliente privado 11')
  const cards = within(
    screen.getByRole('list', { name: 'Reservas do período' }),
  ).getAllByRole('listitem')
  expect(cards[0].textContent).toContain('#12')
  expect(cards[1].textContent).toContain('#11')
  expect(screen.getByText('Cancelada')).toBeTruthy()
  expect(screen.getByText('Confirmada')).toBeTruthy()
  expect(screen.getAllByText('71999999999')).toHaveLength(2)
  expect(screen.getAllByText('Corte histórico')).toHaveLength(2)
  expect(screen.getAllByText(/45,00/)).toHaveLength(2)
  fireEvent.click(screen.getByText('Detalhes do cancelamento da reserva #12'))
  expect(screen.getByText('Primeiro motivo preservado')).toBeTruthy()
  expect(
    screen.queryByRole('button', { name: 'Cancelar reserva #12' }),
  ).toBeNull()
})

it('validates local intervals, accepts 31 inclusive days and resets pagination on applied filters', async () => {
  const mock = mockApi()
  open()
  await screen.findByText('Cliente privado 11')
  fireEvent.change(screen.getByLabelText('De'), {
    target: { value: '2028-02-29' },
  })
  fireEvent.change(screen.getByLabelText('Até'), {
    target: { value: '2028-03-31' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Consultar período' }))
  expect(screen.getByRole('alert').textContent).toContain('31 dias')
  expect(readCalls(mock)).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('Até'), {
    target: { value: '2028-03-30' },
  })
  fireEvent.change(screen.getByLabelText('Por página'), {
    target: { value: '100' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Consultar período' }))
  await waitFor(() => expect(readCalls(mock)).toHaveLength(2))
  const query = new URL(readCalls(mock)[1][0], window.location.origin)
    .searchParams
  expect(Object.fromEntries(query)).toEqual({
    from: '2028-02-29',
    to: '2028-03-30',
    page: '1',
    perPage: '100',
  })
})

it('navigates between days and returns to today without UTC date shifting', async () => {
  const mock = mockApi()
  open()
  await screen.findByText('Cliente privado 11')
  fireEvent.click(screen.getByRole('button', { name: 'Dia seguinte' }))
  await waitFor(() => expect(readCalls(mock)).toHaveLength(2))
  expect(
    new URL(readCalls(mock)[1][0], window.location.origin).searchParams.get(
      'from',
    ),
  ).toBe(adjacentDate(day, 1))
  fireEvent.click(screen.getByRole('button', { name: 'Dia anterior' }))
  await waitFor(() => expect(readCalls(mock)).toHaveLength(3))
  fireEvent.click(screen.getByRole('button', { name: 'Hoje' }))
  await waitFor(() => expect(readCalls(mock)).toHaveLength(4))
  expect(
    new URL(readCalls(mock)[3][0], window.location.origin).searchParams.get(
      'to',
    ),
  ).toBe(day)
})

it('uses server pagination metadata and honours page boundaries', async () => {
  const mock = mockApi((url) =>
    url.pathname === '/api/admin/bookings'
      ? json(list([booking()], Number(url.searchParams.get('page')), 50, 51))
      : undefined,
  )
  open()
  await screen.findByText('Página 1 de 2')
  fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }))
  await screen.findByText('Página 2 de 2')
  expect(
    (
      screen.getByRole('button', {
        name: 'Próxima página',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true)
  expect(
    new URL(readCalls(mock)[1][0], window.location.origin).searchParams.get(
      'page',
    ),
  ).toBe('2')
  fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }))
  await screen.findByText('Página 1 de 2')
})

it('ignores stale filter responses even when transport ignores AbortSignal', async () => {
  const stale = deferred<Response>()
  const mock = mockApi((url) =>
    url.pathname === '/api/admin/bookings' &&
    url.searchParams.get('from') === day
      ? stale.promise
      : undefined,
  )
  open()
  await screen.findByRole('heading', { name: 'Reservas' })
  fireEvent.click(screen.getByRole('button', { name: 'Dia seguinte' }))
  await screen.findByText('Cliente privado 11')
  await act(async () => stale.resolve(json(list([booking(99)]))))
  expect(screen.queryByText('Cliente privado 99')).toBeNull()
  expect(readCalls(mock)).toHaveLength(2)
})

it('requires explicit reason, prevents duplicate sends, and refreshes server history after 200', async () => {
  const pending = deferred<Response>()
  let cancelled = false
  const mock = mockApi((url) => {
    if (url.pathname === '/api/admin/bookings')
      return json(list([booking(11, cancelled ? 'cancelled' : 'confirmed')]))
    if (url.pathname.endsWith('/cancel')) return pending.promise
  })
  open()
  await showDialog()
  expect(document.activeElement).toBe(
    screen.getByLabelText('Motivo do cancelamento'),
  )
  reason('  ')
  confirm()
  expect(screen.getByRole('alert').textContent).toContain('1 a 500')
  expect(cancelCalls(mock)).toHaveLength(0)
  reason('  Motivo informado  ')
  const confirmButton = screen.getByRole('button', {
    name: 'Confirmar cancelamento',
  })
  fireEvent.click(confirmButton)
  fireEvent.click(confirmButton)
  await waitFor(() => expect(cancelCalls(mock)).toHaveLength(1))
  const [, init] = cancelCalls(mock)[0]
  expect(JSON.parse(init?.body as string)).toEqual({
    reason: 'Motivo informado',
  })
  expect(init?.credentials).toBe('include')
  expect(new Headers(init?.headers).get('X-XSRF-TOKEN')).toBe('test=token')
  expect(screen.queryByText(/Histórico preservado/)).toBeNull()
  cancelled = true
  await act(async () =>
    pending.resolve(json({ data: booking(11, 'cancelled') })),
  )
  await screen.findByText('Cancelada')
  expect(screen.getByText('Cliente privado 11')).toBeTruthy()
  expect(screen.getByText('Primeiro motivo preservado')).toBeTruthy()
  expect(readCalls(mock)).toHaveLength(2)
  expect(cancelCalls(mock)).toHaveLength(1)
  expect(document.activeElement).toBe(
    screen.getByRole('heading', { name: 'Reservas' }),
  )
})

it('closes the keyboard dialog without a request and restores focus to its trigger', async () => {
  const mock = mockApi()
  open()
  const dialog = await showDialog()
  fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Cancelar reserva #11' }),
  )
  expect(cancelCalls(mock)).toHaveLength(0)
})

it('does not offer cancellation for started, ended or cancelled reservations', async () => {
  mockApi((url) =>
    url.pathname === '/api/admin/bookings'
      ? json(
          list([
            booking(1, 'confirmed', day, 600),
            booking(2, 'confirmed', day, 720),
            booking(3, 'cancelled'),
          ]),
        )
      : undefined,
  )
  open()
  await screen.findByText('Cliente privado 1')
  expect(screen.queryByRole('button', { name: /^Cancelar reserva/ })).toBeNull()
})

it.each([401, 403])(
  'clears private records and returns to login when refresh is denied with %s',
  async (status) => {
    let denied = false
    mockApi((url) =>
      url.pathname === '/api/admin/bookings' && denied
        ? json({ message: 'Sessão negada.' }, status)
        : undefined,
    )
    open()
    await screen.findByText('Cliente privado 11')
    denied = true
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar lista' }))
    await screen.findByRole('heading', { name: 'Login do administrador' })
    expect(screen.queryByText('Cliente privado 11')).toBeNull()
    expect(screen.queryByText('71999999999')).toBeNull()
  },
)

it.each([403, 419])(
  'keeps authentication and the reason on CSRF failure %s',
  async (status) => {
    mockApi((url) =>
      url.pathname.endsWith('/cancel')
        ? json({ code: 'E_BAD_CSRF_TOKEN' }, status)
        : undefined,
    )
    open()
    await showDialog()
    reason()
    confirm()
    await screen.findByRole('alert')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(
      screen.queryByRole('heading', { name: 'Login do administrador' }),
    ).toBeNull()
    expect(
      (screen.getByLabelText('Motivo do cancelamento') as HTMLTextAreaElement)
        .value,
    ).toBe('Solicitado pelo cliente')
  },
)

it.each([404, 409, 503, 500, 'network', 'malformed'])(
  'reconciles after cancellation error %s and never replays POST',
  async (failure) => {
    let reconciled = false
    const mock = mockApi((url) => {
      if (url.pathname === '/api/admin/bookings' && reconciled)
        return json(list([booking(11, 'cancelled')]))
      if (url.pathname.endsWith('/cancel'))
        return failure === 'network'
          ? Promise.reject(new TypeError('Network failure'))
          : failure === 'malformed'
            ? json({ data: {} })
            : json({}, failure as number)
    })
    open()
    await showDialog()
    reason()
    confirm()
    await screen.findByRole('alert')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/Histórico preservado/)).toBeNull()
    expect(cancelCalls(mock)).toHaveLength(1)
    expect(readCalls(mock)).toHaveLength(1)
    reconciled = true
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar lista' }))
    await screen.findByText('Cancelada')
    expect(
      screen.queryByRole('button', { name: 'Cancelar reserva #11' }),
    ).toBeNull()
    expect(cancelCalls(mock)).toHaveLength(1)
  },
)

it('allows correcting a rejected reason after 422 without discarding the session', async () => {
  const mock = mockApi((url) =>
    url.pathname.endsWith('/cancel')
      ? json({ message: 'Motivo inválido.' }, 422)
      : undefined,
  )
  open()
  await showDialog()
  reason()
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Motivo inválido',
  )
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(cancelCalls(mock)).toHaveLength(1)
})

it('removes private state immediately during logout and does not persist it in storage or URLs', async () => {
  const pending = deferred<Response>()
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  mockApi((url) =>
    url.pathname === '/api/admin/logout' ? pending.promise : undefined,
  )
  open()
  await screen.findByText('Cliente privado 11')
  fireEvent.click(screen.getByRole('button', { name: 'Sair da gestão' }))
  expect(screen.queryByText('Cliente privado 11')).toBeNull()
  expect(screen.queryByText('71999999999')).toBeNull()
  await act(async () => pending.resolve(json({ ok: true })))
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(storage).not.toHaveBeenCalled()
  expect(window.location.href).not.toContain('71999999999')
})

it('ignores private results after navigating away from admin', async () => {
  const pending = deferred<Response>()
  mockApi((url) => {
    if (url.pathname === '/api/admin/bookings') return pending.promise
    if (url.pathname === '/api/services') return json({ data: [] })
  })
  open()
  await screen.findByRole('heading', { name: 'Reservas' })
  fireEvent.click(screen.getByRole('link', { name: 'Agendar' }))
  await screen.findByRole('heading', { name: 'Agende seu horário' })
  await act(async () => pending.resolve(json(list([booking()]))))
  expect(screen.queryByText('Cliente privado 11')).toBeNull()
})

it.each(['list', 'cancel'])(
  'respects Retry-After on %s without automatically retrying',
  async (operation) => {
    const mock = mockApi((url) => {
      if (operation === 'list' && url.pathname === '/api/admin/bookings')
        return json({}, 429, { 'Retry-After': '15' })
      if (operation === 'cancel' && url.pathname.endsWith('/cancel'))
        return json({}, 429, { 'Retry-After': '15' })
    })
    open()
    if (operation === 'cancel') {
      await showDialog()
      reason()
      confirm()
    }
    await screen.findByRole('alert')
    const button = screen.getByRole('button', {
      name: operation === 'list' ? /Aguarde 15s para atualizar/ : 'Aguarde 15s',
    })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(
      operation === 'list' ? readCalls(mock).length : cancelCalls(mock).length,
    ).toBe(1)
  },
)

it('denial during cancellation clears the dialog, its reason and all client data', async () => {
  mockApi((url) =>
    url.pathname.endsWith('/cancel')
      ? json({ message: 'Permissão revogada.' }, 403)
      : undefined,
  )
  open()
  await showDialog()
  reason('Motivo privado')
  confirm()
  await screen.findByRole('heading', { name: 'Login do administrador' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByText('Cliente privado 11')).toBeNull()
  expect(screen.queryByDisplayValue('Motivo privado')).toBeNull()
})

it('a failed reconciliation keeps cancellation blocked instead of reusing stale records', async () => {
  let failed = false
  const mock = mockApi((url) => {
    if (url.pathname.endsWith('/cancel')) {
      failed = true
      return Promise.reject(new TypeError('Offline'))
    }
    if (url.pathname === '/api/admin/bookings' && failed) return json({}, 503)
  })
  open()
  await showDialog()
  reason()
  confirm()
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar lista' }))
  await screen.findByRole('alert')
  expect(
    screen.queryByRole('button', { name: 'Cancelar reserva #11' }),
  ).toBeNull()
  expect(cancelCalls(mock)).toHaveLength(1)
})

it('a reservation reaching its start while the dialog is open cannot be submitted', async () => {
  const mock = mockApi()
  open()
  await showDialog()
  reason()
  vi.mocked(Date.now).mockReturnValue(Date.parse(`${day}T15:00:00-03:00`))
  confirm()
  expect((await screen.findByRole('alert')).textContent).toContain('já começou')
  expect(cancelCalls(mock)).toHaveLength(0)
})

it('returns focus to the opener even when a pointer activation did not focus it first', async () => {
  mockApi()
  open()
  const trigger = await screen.findByRole('button', {
    name: 'Cancelar reserva #11',
  })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: 'Manter reserva' }))
  expect(document.activeElement).toBe(trigger)
})

it('disables the open dialog when its reservation reaches the start time', async () => {
  const mock = mockApi()
  open()
  await showDialog()
  reason()
  vi.mocked(Date.now).mockReturnValue(Date.parse(`${day}T15:00:00-03:00`))
  await waitFor(
    () =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Confirmar cancelamento',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    { timeout: 2000 },
  )
  expect(screen.getByRole('alert').textContent).toContain('já começou')
  expect(cancelCalls(mock)).toHaveLength(0)
})
