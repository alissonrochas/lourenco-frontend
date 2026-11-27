export const BOOKING_TIMEZONE = 'America/Sao_Paulo'
export type PublicService = {
  id: number
  name: string
  description: string | null
  priceCents: number
  durationMinutes: number
  isActive: boolean
  createdAt: string
  updatedAt: string | null
}
export type AvailabilitySlot = {
  startsAtMinute: number
  endsAtMinute: number
  startsAtLocal: string
  endsAtLocal: string
  startsAtUtc: string
  endsAtUtc: string
  startOffsetMinutes: number
  endOffsetMinutes: number
}
export type BookingPolicy = {
  minDate: string
  maxDate: string
  timezone: typeof BOOKING_TIMEZONE
}
export function readBookingPolicy(value: unknown): BookingPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const p = value as Record<string, unknown>
  if (!isLocalDate(p.minDate) || !isLocalDate(p.maxDate) || p.minDate > p.maxDate || p.timezone !== BOOKING_TIMEZONE) return null
  return { minDate: p.minDate, maxDate: p.maxDate, timezone: BOOKING_TIMEZONE }
}
export function dateWithinPolicy(date: string, policy: BookingPolicy) {
  return isLocalDate(date) && date >= policy.minDate && date <= policy.maxDate
}
export type Availability = {
  localDate: string
  weekday: number
  timezone: typeof BOOKING_TIMEZONE
  slotDurationMinutes: 60
  policy: BookingPolicy
  slots: AvailabilitySlot[]
}
export type BookingInput = {
  serviceId: number
  localDate: string
  startsAtMinute: number
  name: string
  phone: string
}
export type BookingConfirmation = {
  id: number
  serviceName: string
  priceCents: number
  localDate: string
  startsAtMinute: number
  startsAtLocal: string
  endsAtLocal: string
  timezone: typeof BOOKING_TIMEZONE
  slotDurationMinutes: 60
  status: 'confirmed'
}
export function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: BOOKING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: string) =>
    parts.find((part) => part.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return (
    year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
  )
}
export const formatDate = (value: string) =>
  value.split('-').reverse().join('/')
export const formatTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
export const formatPrice = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    cents / 100,
  )
export function contactError(name: string, phone: string) {
  if (name.trim().length < 2 || name.trim().length > 120)
    return 'Informe um nome com 2 a 120 caracteres.'
  const digits = phone.replace(/\D/g, '')
  if (
    phone.trim().length > 30 ||
    !/^[0-9()+\-\s]+$/.test(phone) ||
    digits.length < 10 ||
    digits.length > 15
  )
    return 'Informe um telefone válido com 10 a 15 dígitos.'
  return null
}
