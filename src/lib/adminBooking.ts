import { isLocalDate, type BookingConfirmation } from './booking'

export type AdminBooking = Omit<BookingConfirmation, 'status'> & {
  status: 'confirmed' | 'cancelled'
  customer: { name: string; phone: string }
  cancellation: {
    cancelledAtUtc: number
    cancelledByUserId: number
    reason: string
  } | null
}
export type BookingFilters = {
  from: string
  to: string
  page: number
  perPage: number
}
export type AdminBookingList = {
  data: AdminBooking[]
  meta: { page: number; perPage: number; total: number; lastPage: number }
}
function monthDays(year: number) {
  return [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
}
function ordinal(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  const previous = year - 1
  return (
    previous * 365 +
    Math.floor(previous / 4) -
    Math.floor(previous / 100) +
    Math.floor(previous / 400) +
    monthDays(year)
      .slice(0, month - 1)
      .reduce((sum, length) => sum + length, 0) +
    day
  )
}
export function rangeError(from: string, to: string) {
  if (
    !isLocalDate(from) ||
    !isLocalDate(to) ||
    to < from ||
    ordinal(to) - ordinal(from) >= 31
  )
    return 'Escolha datas válidas em um intervalo de até 31 dias, incluindo início e fim.'
  return null
}
export function adjacentDate(value: string, direction: -1 | 1) {
  if (!isLocalDate(value)) return null
  let [year, month, day] = value.split('-').map(Number)
  day += direction
  if (day < 1) {
    month--
    if (month < 1) {
      year--
      month = 12
    }
    if (year < 1) return null
    day = monthDays(year)[month - 1]
  }
  if (day > monthDays(year)[month - 1]) {
    day = 1
    month++
    if (month > 12) {
      year++
      month = 1
    }
  }
  return year > 9999
    ? null
    : `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
export function canCancel(booking: AdminBooking, now: number) {
  return (
    booking.status === 'confirmed' && Date.parse(booking.startsAtLocal) > now
  )
}
export function isAdminBooking(value: unknown): value is AdminBooking {
  if (!value || typeof value !== 'object') return false
  const b = value as AdminBooking
  return (
    Number.isSafeInteger(b.id) &&
    b.id > 0 &&
    !!b.customer &&
    typeof b.customer.name === 'string' &&
    typeof b.customer.phone === 'string' &&
    typeof b.serviceName === 'string' &&
    Number.isSafeInteger(b.priceCents) &&
    b.priceCents >= 0 &&
    typeof b.localDate === 'string' &&
    isLocalDate(b.localDate) &&
    Number.isInteger(b.startsAtMinute) &&
    b.startsAtMinute >= 0 &&
    b.startsAtMinute <= 1380 &&
    b.startsAtMinute % 60 === 0 &&
    typeof b.startsAtLocal === 'string' &&
    b.startsAtLocal.startsWith(`${b.localDate}T`) &&
    Number.isFinite(Date.parse(b.startsAtLocal)) &&
    typeof b.endsAtLocal === 'string' &&
    Date.parse(b.endsAtLocal) - Date.parse(b.startsAtLocal) === 3600000 &&
    b.timezone === 'America/Sao_Paulo' &&
    b.slotDurationMinutes === 60 &&
    ((b.status === 'confirmed' && b.cancellation === null) ||
      (b.status === 'cancelled' &&
        !!b.cancellation &&
        Number.isSafeInteger(b.cancellation.cancelledAtUtc) &&
        Number.isFinite(new Date(b.cancellation.cancelledAtUtc).getTime()) &&
        Number.isSafeInteger(b.cancellation.cancelledByUserId) &&
        b.cancellation.cancelledByUserId > 0 &&
        typeof b.cancellation.reason === 'string'))
  )
}
