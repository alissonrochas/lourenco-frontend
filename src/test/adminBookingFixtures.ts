import { todayInSaoPaulo, formatTime } from '@/lib/booking'
import type { AdminBooking } from '@/lib/adminBooking'
export const admin = {
  id: 7,
  fullName: 'Gerente',
  email: 'admin@example.test',
  role: 'admin',
}
export const day = todayInSaoPaulo()
export function booking(
  id = 11,
  status: AdminBooking['status'] = 'confirmed',
  localDate = day,
  minute = 900,
): AdminBooking {
  return {
    id,
    customer: { name: `Cliente privado ${id}`, phone: '71999999999' },
    serviceName: 'Corte histórico',
    priceCents: 4500,
    localDate,
    startsAtMinute: minute,
    startsAtLocal: `${localDate}T${formatTime(minute)}:00.000-03:00`,
    endsAtLocal: `${localDate}T${formatTime(minute + 60)}:00.000-03:00`,
    timezone: 'America/Sao_Paulo',
    slotDurationMinutes: 60,
    status,
    cancellation:
      status === 'cancelled'
        ? {
            cancelledAtUtc: Date.parse(`${localDate}T10:00:00-03:00`),
            cancelledByUserId: 7,
            reason: 'Primeiro motivo preservado',
          }
        : null,
  }
}
export function list(
  data: AdminBooking[],
  page = 1,
  perPage = 50,
  total = data.length,
) {
  return {
    data,
    meta: {
      page,
      perPage,
      total,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
    },
  }
}
export function json(payload: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
