import { formatTime } from '@/lib/booking'
import type {
  Availability,
  BookingConfirmation,
  PublicService,
} from '@/lib/booking'
export const date = '2099-12-28'
export const policy = { minDate: '2099-12-01', maxDate: '2099-12-31', timezone: 'America/Sao_Paulo' as const }
export const service: PublicService = {
  id: 7,
  name: 'Corte clássico',
  description: 'Acabamento com cuidado.',
  priceCents: 4500,
  durationMinutes: 45,
  isActive: true,
  createdAt: '2026-11-01T12:00:00Z',
  updatedAt: null,
}
export const confirmation: BookingConfirmation = {
  id: 321,
  serviceName: 'Corte confirmado pelo servidor',
  priceCents: 5000,
  localDate: date,
  startsAtMinute: 540,
  startsAtLocal: `${date}T09:00:00.000-03:00`,
  endsAtLocal: `${date}T10:00:00.000-03:00`,
  timezone: 'America/Sao_Paulo',
  slotDurationMinutes: 60,
  status: 'confirmed',
}
export function availability(
  localDate = date,
  starts = [540, 600],
): Availability {
  return {
    localDate,
    weekday: 1,
    timezone: 'America/Sao_Paulo',
    slotDurationMinutes: 60,
    policy,
    slots: starts.map((minute) => ({
      startsAtMinute: minute,
      endsAtMinute: minute + 60,
      startsAtLocal: `${localDate}T${formatTime(minute)}:00.000`,
      endsAtLocal: `${localDate}T${formatTime(minute + 60)}:00.000`,
      startsAtUtc: `${localDate}T${formatTime(minute + 180)}:00.000Z`,
      endsAtUtc: `${localDate}T${formatTime(minute + 240)}:00.000Z`,
      startOffsetMinutes: -180,
      endOffsetMinutes: -180,
    })),
  }
}
export const json = (payload: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
