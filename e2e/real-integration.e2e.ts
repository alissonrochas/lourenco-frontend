import { test as base, expect, type Page, type BrowserContext } from '@playwright/test'
import { spawn } from 'node:child_process'
import { openSync, closeSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  integrationContext,
  fixture,
  rows,
  waitForPort,
  stop,
  type FixtureInfo,
} from './environment.mjs'

const env = integrationContext()
const password = 'E2eOnly!Password123'
const test = base.extend<{ integration: FixtureInfo; mode: string }>({
  mode: ['base', { option: true }],
  integration: [
    async ({ mode }, provide, testInfo) => {
      // The previous scenario's process is stopped before deleting this disposable file.
      for (const suffix of ['', '-wal', '-shm']) rmSync(env.database + suffix, { force: true })
      const info = await fixture(mode)
      const fd = openSync(join(env.root, 'servers.log'), 'a')
      const backend = spawn(process.execPath, ['--import', '@poppinss/ts-exec', 'bin/server.ts'], {
        cwd: env.backendRoot,
        env: env.backendEnv,
        stdio: ['ignore', fd, fd],
      })
      try {
        await waitForPort(env.backendURL, backend)
        testInfo.annotations.push({
          type: 'isolation',
          description:
            'Fresh SQLite file, real Lucid migrations, database sessions and fresh backend process per scenario.',
        })
        await provide(info)
      } finally {
        await stop(backend)
        closeSync(fd)
      }
    },
    { auto: true },
  ],
})
async function prepareBooking(page: Page, info: FixtureInfo, name = 'Cliente E2E') {
  await page.goto('/')
  await page.getByRole('radio', { name: /Corte E2E/ }).check()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await page.getByLabel('Data do atendimento').fill(info.date)
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await expect(page.getByRole('radio', { name: '10:00', exact: true })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: '12:00', exact: true })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: '15:00', exact: true })).toHaveCount(0)
  await page.getByRole('radio', { name: '09:00', exact: true }).check()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await page.getByLabel('Nome completo').fill(name)
  await page.getByLabel('Telefone', { exact: true }).fill('71999999999')
  await page.getByRole('button', { name: 'Revisar agendamento' }).click()
}
async function book(page: Page, info: FixtureInfo) {
  await prepareBooking(page, info)
  const response = page.waitForResponse(
    (r) => r.url() === `${env.backendURL}/api/bookings` && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Confirmar agendamento' }).click()
  const created = await response
  expect(created.status()).toBe(201)
  expect(created.headers()['access-control-allow-origin']).toBe(env.frontendURL)
  expect(created.headers()['access-control-allow-credentials']).toBe('true')
  expect(await created.request().headerValue('X-XSRF-TOKEN')).toBeTruthy()
  await expect(page.getByRole('heading', { name: 'Agendamento confirmado' })).toBeVisible()
  return rows('SELECT * FROM bookings WHERE status = ?', ['confirmed'])[0]
}
async function login(page: Page) {
  await page.goto('/admin')
  await page.getByLabel('E-mail', { exact: true }).fill('admin@e2e.example.test')
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar na gestão' }).click()
  await expect(page.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
}
async function filter(page: Page, from: string, to = from) {
  await page.getByLabel('De', { exact: true }).fill(from)
  await page.getByLabel('Até', { exact: true }).fill(to)
  const response = page.waitForResponse(
    (r) =>
      r.url().startsWith(`${env.backendURL}/api/admin/bookings?`) &&
      new URL(r.url()).searchParams.get('from') === from &&
      new URL(r.url()).searchParams.get('to') === to,
  )
  await page.getByRole('button', { name: 'Consultar período' }).click()
  expect((await response).status()).toBe(200)
  await expect(page.getByText('Carregando reservas…')).toHaveCount(0)
}
async function csrf(context: BrowserContext) {
  const response = await context.request.get(`${env.backendURL}/api/csrf`)
  expect(response.status()).toBe(200)
  const cookie = (await context.cookies(env.backendURL)).find((item) => item.name === 'XSRF-TOKEN')
  expect(cookie).toBeTruthy()
  return decodeURIComponent(cookie!.value)
}
async function post(context: BrowserContext, path: string, data: unknown) {
  const token = await csrf(context)
  return context.request.post(`${env.backendURL}${path}`, {
    data,
    headers: { 'X-XSRF-TOKEN': token },
  })
}

// Browser helpers traverse the real React UI. SQL inspection never writes data.
test('A — browser public booking, real calendar, HTTP 201 and SQLite persistence', async ({
  page,
  context,
  integration,
}) => {
  const persisted = await book(page, integration)
  expect(persisted.local_date).toBe(integration.date)
  expect(persisted.starts_at_minute).toBe(540)
  expect(Number(persisted.ends_at_utc) - Number(persisted.starts_at_utc)).toBe(3600000)
  expect(persisted.service_name_snapshot).toBe('Corte E2E')
  expect(persisted.service_price_cents_snapshot).toBe(4500)
  expect(rows('SELECT phone_normalized FROM customers')[0].phone_normalized).toBe('71999999999')
  const cookies = await context.cookies(env.backendURL)
  expect(
    cookies.some(
      (c) => c.name === 'adonis-session' && c.httpOnly && c.sameSite === 'Lax' && !c.secure,
    ),
  ).toBe(true)
  expect(cookies.some((c) => c.name === 'XSRF-TOKEN' && !c.httpOnly)).toBe(true)
  expect(rows('SELECT COUNT(*) AS count FROM sessions')[0].count).toBeGreaterThan(0)
  const sessions = rows('SELECT * FROM sessions')
  const closed = await context.request.get(
    `${env.backendURL}/api/availability?date=${integration.closedDate}`,
  )
  expect((await closed.json()).data.slots).toEqual([])
  expect(closed.headers()['set-cookie']).toBeUndefined()
  expect(rows('SELECT * FROM sessions')).toEqual(sessions)
})

test('B — HTTP duplicate rejection against SQLite after a browser confirmation', async ({
  page,
  context,
  integration,
}) => {
  await book(page, integration)
  const duplicate = await post(context, '/api/bookings', {
    serviceId: integration.serviceId,
    localDate: integration.date,
    startsAtMinute: 540,
    name: 'Outra pessoa E2E',
    phone: '71988888888',
  })
  expect(duplicate.status()).toBe(409)
  expect(rows("SELECT COUNT(*) AS count FROM bookings WHERE status = 'confirmed'")[0].count).toBe(1)
  expect(rows('SELECT COUNT(*) AS count FROM customers')[0].count).toBe(1)
})

test.describe('C — seeded pagination with real creation service', () => {
  test.use({ mode: 'pagination' })
  test('browser login, real filters and metadata pagination', async ({ page, integration }) => {
    await login(page)
    await filter(page, integration.date, integration.to)
    await expect(page.getByText('51 reservas no período', { exact: false })).toBeVisible()
    await expect(page.getByText('Página 1 de 2')).toBeVisible()
    await expect(page.locator('.agenda-card')).toHaveCount(50)
    await expect(page.locator('.agenda-card').first()).toContainText('Cliente Paginação E2E')
    await expect(page.locator('.agenda-card').first()).toContainText('71970000000')
    await expect(page.locator('.agenda-card').first()).toContainText('R$ 45,00')
    await expect(page.locator('.agenda-card').first()).toContainText('Corte E2E')
    await expect(page.locator('.agenda-card').first()).toContainText('Confirmada')
    const first = rows(
      'SELECT bookings.*, customers.name AS customer_name, customers.phone FROM bookings JOIN customers ON customers.id = bookings.customer_id ORDER BY starts_at_utc, bookings.id LIMIT 1',
    )[0]
    expect(first.customer_name).toBe('Cliente Paginação E2E')
    expect(first.phone).toBe('71970000000')
    expect(first.service_name_snapshot).toBe('Corte E2E')
    expect(first.service_price_cents_snapshot).toBe(4500)
    expect(first.status).toBe('confirmed')
    await page.getByRole('button', { name: 'Próxima página' }).click()
    await expect(page.getByText('Página 2 de 2')).toBeVisible()
    await expect(page.locator('.agenda-card')).toHaveCount(1)
    expect(rows("SELECT COUNT(*) AS count FROM bookings WHERE status='confirmed'")[0].count).toBe(
      51,
    )
  })
})

test('D — browser cancellation, HTTP 200, real audit/history and released availability', async ({
  page,
  context,
  integration,
}) => {
  const original = await book(page, integration)
  await login(page)
  await filter(page, integration.date)
  await expect(page.getByText('Cliente E2E', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: `Cancelar reserva #${original.id}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.getByLabel('Motivo do cancelamento').fill('Solicitado no cenário E2E')
  const response = page.waitForResponse((r) =>
    r.url().endsWith(`/api/admin/bookings/${original.id}/cancel`),
  )
  await page.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click()
  expect((await response).status()).toBe(200)
  await expect(page.getByText('Cancelada', { exact: true })).toBeVisible()
  await page.reload()
  await filter(page, integration.date)
  await page.getByText(`Detalhes do cancelamento da reserva #${original.id}`).click()
  await expect(page.getByText('Solicitado no cenário E2E', { exact: true })).toBeVisible()
  const saved = rows('SELECT * FROM bookings WHERE id = ?', [original.id])[0]
  expect(saved.status).toBe('cancelled')
  expect(saved.cancelled_by_user_id).toBe(integration.adminId)
  expect(saved.cancelled_at_utc).toBeGreaterThan(0)
  for (const field of [
    'id',
    'customer_id',
    'service_id',
    'starts_at_utc',
    'ends_at_utc',
    'service_name_snapshot',
    'service_price_cents_snapshot',
  ])
    expect(saved[field]).toBe(original[field])
  const availability = await context.request.get(
    `${env.backendURL}/api/availability?date=${integration.date}`,
  )
  const body = await availability.json()
  expect(
    body.data.slots.some((slot: { startsAtMinute: number }) => slot.startsAtMinute === 540),
  ).toBe(true)
  expect(JSON.stringify(body)).not.toContain('Solicitado no cenário E2E')
  expect(JSON.stringify(body)).not.toContain('71999999999')
  const repeated = await post(context, `/api/admin/bookings/${original.id}/cancel`, {
    reason: 'Outro motivo',
  })
  expect(repeated.status()).toBe(200)
  expect(rows('SELECT * FROM bookings WHERE id = ?', [original.id])[0]).toEqual(saved)
})

test('E1 — anonymous HTTP denied and ordinary-user browser login denied', async ({
  page,
  request,
}) => {
  expect(
    (
      await request.get(`${env.backendURL}/api/admin/bookings?from=2026-01-01&to=2026-01-01`)
    ).status(),
  ).toBe(401)
  await page.goto('/admin')
  await page.getByLabel('E-mail', { exact: true }).fill('user@e2e.example.test')
  await page.getByLabel('Senha', { exact: true }).fill(password)
  const response = page.waitForResponse((r) => r.url().endsWith('/api/admin/login'))
  await page.getByRole('button', { name: 'Entrar na gestão' }).click()
  expect((await response).status()).toBe(403)
  await expect(page.getByRole('heading', { name: 'Reservas', exact: true })).toHaveCount(0)
})

test('E2 — authenticated HTTP cancellation without CSRF cannot write audit', async ({
  page,
  context,
  integration,
}) => {
  const original = await book(page, integration)
  await login(page)
  const response = await context.request.post(
    `${env.backendURL}/api/admin/bookings/${original.id}/cancel`,
    { data: { reason: 'Sem CSRF' } },
  )
  expect(response.status()).toBe(403)
  expect((await response.json()).code).toBe('E_BAD_CSRF_TOKEN')
  expect(rows('SELECT * FROM bookings WHERE id = ?', [original.id])[0]).toEqual(original)
})

test('E3 — real role revocation removes private UI after HTTP 403', async ({
  page,
  integration,
}) => {
  await book(page, integration)
  await login(page)
  await filter(page, integration.date)
  await fixture('revoke')
  const response = page.waitForResponse((r) => r.url().includes('/api/admin/bookings?'))
  await page.getByRole('button', { name: 'Atualizar lista' }).click()
  expect((await response).status()).toBe(403)
  await expect(page.getByRole('heading', { name: 'Login do administrador' })).toBeVisible()
  await expect(page.getByText('Cliente E2E', { exact: true })).toHaveCount(0)
})

test('E4 — real database session expiration returns the browser to login', async ({ page }) => {
  await login(page)
  await fixture('expire')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Login do administrador' })).toBeVisible()
})

test.describe('E5 — persisted historical booking', () => {
  test.use({ mode: 'started' })
  test('browser hides action and real HTTP rejects cancellation of started booking', async ({
    page,
    context,
    integration,
  }) => {
    await login(page)
    await filter(page, integration.startedDate!)
    await expect(page.getByText('Cliente histórico E2E', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Cancelar reserva/ })).toHaveCount(0)
    const response = await post(context, `/api/admin/bookings/${integration.startedId}/cancel`, {
      reason: 'Tentativa histórica',
    })
    expect(response.status()).toBe(409)
    expect(
      rows('SELECT status FROM bookings WHERE id = ?', [integration.startedId])[0].status,
    ).toBe('confirmed')
  })
})

test('E6 — two real browser contexts race for one SQLite slot', async ({
  page,
  browser,
  integration,
}) => {
  const second = await browser.newContext({
    baseURL: env.frontendURL,
    timezoneId: 'America/Sao_Paulo',
    viewport: page.viewportSize()!,
  })
  try {
    const other = await second.newPage()
    await prepareBooking(page, integration, 'Concorrente A E2E')
    await prepareBooking(other, integration, 'Concorrente B E2E')
    const firstResponse = page.waitForResponse(
      (r) => r.url().endsWith('/api/bookings') && r.request().method() === 'POST',
    )
    const secondResponse = other.waitForResponse(
      (r) => r.url().endsWith('/api/bookings') && r.request().method() === 'POST',
    )
    await Promise.all([
      page.getByRole('button', { name: 'Confirmar agendamento' }).click(),
      other.getByRole('button', { name: 'Confirmar agendamento' }).click(),
    ])
    const responses = await Promise.all([firstResponse, secondResponse])
    const statuses = responses.map((r) => r.status()).sort()
    expect(statuses[0]).toBe(201)
    expect([409, 503]).toContain(statuses[1])
    expect(rows("SELECT COUNT(*) AS count FROM bookings WHERE status='confirmed'")[0].count).toBe(1)
    expect(rows('SELECT COUNT(*) AS count FROM customers')[0].count).toBe(1)
  } finally {
    await second.close()
  }
})

test('E7 — drop only the real HTTP response after server commit; UI remains uncertain', async ({
  page,
  integration,
}) => {
  await prepareBooking(page, integration)
  let dispatched = 0
  // Fault injection only: endpoint executes for real; no fake payload is returned.
  await page.route(`${env.backendURL}/api/bookings`, async (route) => {
    dispatched++
    const real = await route.fetch()
    expect(real.status()).toBe(201)
    await route.abort('failed')
  })
  await page.getByRole('button', { name: 'Confirmar agendamento' }).click()
  await expect(page.getByRole('heading', { name: 'Confirmação não recebida' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Agendamento confirmado', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Confirmar agendamento' })).toHaveCount(0)
  expect(dispatched).toBe(1)
  expect(rows("SELECT COUNT(*) AS count FROM bookings WHERE status='confirmed'")[0].count).toBe(1)
})

test('E8 — real rate limiting and browser CORS visibility of Retry-After', async ({
  page,
  context,
  integration,
}) => {
  await page.goto('/')
  await page.getByRole('radio', { name: /Corte E2E/ }).check()
  const statuses = await page.evaluate(
    async ({ api, date }) => {
      const result: number[] = []
      for (let count = 0; count < 60; count++)
        result.push(
          (await fetch(`${api}/api/availability?date=${date}`, { credentials: 'include' })).status,
        )
      return result
    },
    { api: env.backendURL, date: integration.date },
  )
  expect(statuses.every((status) => status === 200)).toBe(true)
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await page.getByLabel('Data do atendimento').fill(integration.date)
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Muitas tentativas')
  await expect(
    page.getByRole('button', { name: /Aguarde .* para atualizar horários/ }),
  ).toBeDisabled()
  const raw = await context.request.get(
    `${env.backendURL}/api/availability?date=${integration.date}`,
  )
  expect(raw.status()).toBe(429)
  expect(Number(raw.headers()['retry-after'])).toBeGreaterThan(0)
  const visible = await page.evaluate(
    async ({ api, date }) =>
      (await fetch(`${api}/api/availability?date=${date}`, { credentials: 'include' })).headers.get(
        'Retry-After',
      ),
    { api: env.backendURL, date: integration.date },
  )
  expect(visible).toBeNull() // Current backend explicitly exposes no response headers.
})

// Stage 7 uses the same real-server fixtures; no service endpoint is mocked.
async function services(page: Page) {
  await page.getByRole('button', { name: 'Serviços', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Editar serviço Corte E2E' })).toBeVisible()
}
async function confirmService(page: Page, method: 'POST' | 'PATCH') {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.startsWith('/api/admin/services') &&
      r.request().method() === method,
  )
  await page.getByRole('button', { name: 'Confirmar alteração' }).click()
  const saved = await response
  expect(saved.status()).toBe(method === 'POST' ? 201 : 200)
  expect(await saved.request().headerValue('X-XSRF-TOKEN')).toBeTruthy()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  return saved
}
test('S1 — browser creates a service with exact cents, confirmation and public offer', async ({
  page,
}, testInfo) => {
  await login(page)
  await services(page)
  await page.getByRole('button', { name: 'Novo serviço', exact: true }).click()
  await expect(page.getByLabel('Nome do serviço')).toBeFocused()
  await page.getByLabel('Nome do serviço').fill('Barba E2E')
  await page.getByLabel('Descrição (opcional)').fill('  Toalha quente  ')
  await page.getByLabel('Preço (R$)').fill('32,999')
  await page.getByLabel('Duração (minutos)').fill('30')
  await page.getByRole('button', { name: 'Revisar alterações' }).click()
  await expect(page.getByRole('alert')).toContainText('duas casas')
  expect(rows('SELECT COUNT(*) AS total FROM services')[0].total).toBe(1)
  await page.getByLabel('Preço (R$)').fill('32,99')
  await page.getByRole('button', { name: 'Revisar alterações' }).click()
  await expect(page.getByRole('button', { name: 'Voltar sem salvar' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Revisar alterações' })).toBeFocused()
  expect(rows('SELECT COUNT(*) AS total FROM services')[0].total).toBe(1)
  await page.keyboard.press('Enter')
  await confirmService(page, 'POST')
  await expect(page.getByRole('button', { name: 'Editar serviço Barba E2E' })).toBeVisible()
  const saved = rows('SELECT * FROM services WHERE name = ?', ['Barba E2E'])[0]
  expect(saved.price_cents).toBe(3299)
  expect(saved.duration_minutes).toBe(30)
  expect(saved.description).toBe('Toalha quente')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: testInfo.outputPath('services-dashboard.png'), fullPage: true })
  await page.goto('/')
  await expect(page.getByRole('radio', { name: /Barba E2E/ })).toBeVisible()
})
test('S2 — service edits and activation preserve every persisted booking field and historical UI', async ({
  page,
  integration,
}) => {
  const original = await book(page, integration)
  await login(page)
  await services(page)
  await page.getByRole('button', { name: 'Editar serviço Corte E2E' }).click()
  await page.getByLabel('Nome do serviço').fill('Corte Premium E2E')
  await page.getByLabel('Descrição (opcional)').fill('Nova descrição')
  await page.getByLabel('Preço (R$)').fill('65,50')
  await page.getByLabel('Duração (minutos)').fill('90')
  await page.getByRole('button', { name: 'Revisar alterações' }).click()
  const response = await confirmService(page, 'PATCH')
  expect(response.request().postDataJSON()).toEqual({
    name: 'Corte Premium E2E',
    description: 'Nova descrição',
    priceCents: 6550,
    durationMinutes: 90,
  })
  await expect(page.getByRole('button', { name: 'Editar serviço Corte Premium E2E' })).toBeVisible()
  await page.getByRole('button', { name: 'Desativar serviço Corte Premium E2E' }).click()
  await expect(page.getByRole('dialog')).toContainText('deixará de ser oferecido')
  await confirmService(page, 'PATCH')
  await expect(page.getByText('Inativo', { exact: true })).toBeVisible()
  expect(rows('SELECT * FROM bookings WHERE id = ?', [original.id])[0]).toEqual(original)
  await page.getByRole('button', { name: 'Agenda', exact: true }).click()
  await filter(page, integration.date)
  await expect(page.locator('.agenda-card')).toContainText('Corte E2E')
  await expect(page.locator('.agenda-card')).toContainText('R$ 45,00')
  await expect(page.locator('.agenda-card')).not.toContainText('65,50')
  await page.goto('/')
  await expect(page.getByText(/Nenhum serviço disponível no momento/)).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)
  await page.goto('/admin')
  await page.getByRole('button', { name: 'Serviços', exact: true }).click()
  await page.getByRole('button', { name: 'Ativar serviço Corte Premium E2E' }).click()
  await confirmService(page, 'PATCH')
  await expect(page.getByText('Ativo', { exact: true })).toBeVisible()
  expect(rows('SELECT * FROM bookings WHERE id = ?', [original.id])[0]).toEqual(original)
  await page.goto('/')
  await expect(page.getByRole('radio', { name: /Corte Premium E2E/ })).toBeVisible()
})
test('S3 — real service authorization, CSRF and role revocation keep data protected', async ({
  page,
  context,
  request,
  integration,
}) => {
  expect((await request.get(`${env.backendURL}/api/admin/services`)).status()).toBe(401)
  await login(page)
  await services(page)
  const before = rows('SELECT * FROM services')
  const denied = await context.request.patch(
    `${env.backendURL}/api/admin/services/${integration.serviceId}`,
    { data: { isActive: false } },
  )
  expect(denied.status()).toBe(403)
  expect((await denied.json()).code).toBe('E_BAD_CSRF_TOKEN')
  expect(rows('SELECT * FROM services')).toEqual(before)
  await fixture('revoke')
  await page.getByRole('button', { name: 'Atualizar serviços' }).click()
  await expect(page.getByRole('heading', { name: 'Login do administrador' })).toBeVisible()
  await expect(page.getByText('Corte E2E', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Novo serviço' })).toHaveCount(0)
})
test('S4 — lost real creation response blocks writes until server reconciliation without duplicate', async ({
  page,
}) => {
  await login(page)
  await services(page)
  await page.getByRole('button', { name: 'Novo serviço', exact: true }).click()
  await page.getByLabel('Nome do serviço').fill('Resultado incerto E2E')
  await page.getByLabel('Preço (R$)').fill('20')
  await page.getByRole('button', { name: 'Revisar alterações' }).click()
  let sent = 0
  await page.route(`${env.backendURL}/api/admin/services`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    sent++
    const real = await route.fetch()
    expect(real.status()).toBe(201)
    await route.abort('failed')
  })
  await page.getByRole('button', { name: 'Confirmar alteração' }).click()
  await expect(page.getByRole('alert')).toContainText('O serviço pode ter sido salvo')
  await expect(page.getByRole('button', { name: 'Novo serviço', exact: true })).toBeDisabled()
  expect(sent).toBe(1)
  expect(
    rows('SELECT COUNT(*) AS total FROM services WHERE name = ?', ['Resultado incerto E2E'])[0]
      .total,
  ).toBe(1)
  await page.getByRole('button', { name: 'Atualizar serviços' }).click()
  await expect(
    page.getByRole('button', { name: 'Editar serviço Resultado incerto E2E' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Novo serviço', exact: true })).toBeEnabled()
  expect(sent).toBe(1)
})
