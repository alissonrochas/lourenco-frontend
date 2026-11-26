import { isLocalDate, todayInSaoPaulo } from './booking'
export type Pause = { startsAtMinute: number; endsAtMinute: number; isActive: boolean }
export type SlotBlock = { startsAtMinute: number; isBlocked: boolean }
export type ScheduleDay = {
  weekday: number
  isConfigured: boolean
  isActive: boolean
  opensAtMinute: number | null
  closesAtMinute: number | null
  breaks: Pause[]
  slotBlocks: SlotBlock[]
}
export type WeeklySchedule = {
  timezone: 'America/Sao_Paulo'
  slotDurationMinutes: 60
  days: ScheduleDay[]
}
export type ExceptionRecord = {
  id: number
  localDate: string
  isBlocked: boolean
  reason: string | null
  createdAt: string
  updatedAt: string | null
}
export type DateExceptions = {
  dateBlocks: ExceptionRecord[]
  slotBlocks: (ExceptionRecord & { startsAtMinute: number })[]
}
export type DayPatch = Omit<ScheduleDay, 'isConfigured'>
export type ExceptionInput = {
  localDate: string
  dayBlock?: { isBlocked: boolean; reason?: string }
  slotBlocks?: (SlotBlock & { reason?: string })[]
}
export type WeeklyDraft = {
  isActive: boolean
  opens: string
  closes: string
  breaks: { start: string; end: string }[]
  slots: number[]
}
export const weekdays = [
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
  'Domingo',
]
export const hours = Array.from({ length: 24 }, (_, i) => i * 60)
const hour = (v: unknown, end = false): v is number =>
  Number.isInteger(v) &&
  Number(v) >= (end ? 60 : 0) &&
  Number(v) <= (end ? 1440 : 1380) &&
  Number(v) % 60 === 0
export function validWeekly(value: unknown): value is WeeklySchedule {
  if (!value || typeof value !== 'object') return false
  const s = value as WeeklySchedule
  return (
    s.timezone === 'America/Sao_Paulo' &&
    s.slotDurationMinutes === 60 &&
    Array.isArray(s.days) &&
    s.days.length === 7 &&
    s.days.every(
      (d, i) =>
        d &&
        d.weekday === i + 1 &&
        typeof d.isConfigured === 'boolean' &&
        typeof d.isActive === 'boolean' &&
        ((d.opensAtMinute === null &&
          d.closesAtMinute === null &&
          !d.isActive &&
          !d.isConfigured) ||
          (hour(d.opensAtMinute) &&
            hour(d.closesAtMinute, true) &&
            d.opensAtMinute < d.closesAtMinute &&
            d.isConfigured)) &&
        Array.isArray(d.breaks) &&
        d.breaks.every(
          (p) =>
            p &&
            hour(p.startsAtMinute) &&
            hour(p.endsAtMinute, true) &&
            p.startsAtMinute < p.endsAtMinute &&
            typeof p.isActive === 'boolean',
        ) &&
        Array.isArray(d.slotBlocks) &&
        d.slotBlocks.every((b) => b && hour(b.startsAtMinute) && typeof b.isBlocked === 'boolean'),
    )
  )
}
export function validExceptions(value: unknown, date: string): value is DateExceptions {
  if (!value || typeof value !== 'object') return false
  const s = value as DateExceptions
  const record = (r: ExceptionRecord) =>
    r &&
    Number.isSafeInteger(r.id) &&
    r.id > 0 &&
    r.localDate === date &&
    typeof r.isBlocked === 'boolean' &&
    (r.reason === null || (typeof r.reason === 'string' && r.reason.length <= 500)) &&
    typeof r.createdAt === 'string' &&
    Number.isFinite(Date.parse(r.createdAt)) &&
    (r.updatedAt === null ||
      (typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt))))
  return (
    Array.isArray(s.dateBlocks) &&
    s.dateBlocks.length <= 1 &&
    s.dateBlocks.every(record) &&
    Array.isArray(s.slotBlocks) &&
    s.slotBlocks.length <= 24 &&
    s.slotBlocks.every((r) => record(r) && hour(r.startsAtMinute)) &&
    new Set(s.slotBlocks.map((r) => r.startsAtMinute)).size === s.slotBlocks.length
  )
}
export function weeklyDraft(day: ScheduleDay): WeeklyDraft {
  return {
    isActive: day.isActive,
    opens: day.opensAtMinute === null ? '' : String(day.opensAtMinute),
    closes: day.closesAtMinute === null ? '' : String(day.closesAtMinute),
    breaks: day.breaks
      .filter((p) => p.isActive)
      .map((p) => ({ start: String(p.startsAtMinute), end: String(p.endsAtMinute) })),
    slots: day.slotBlocks.filter((b) => b.isBlocked).map((b) => b.startsAtMinute),
  }
}
export function weeklyPatch(weekday: number, d: WeeklyDraft): DayPatch {
  const opens = d.opens === '' ? null : Number(d.opens),
    closes = d.closes === '' ? null : Number(d.closes)
  const breaks = d.breaks.map((p) => ({
    startsAtMinute: p.start === '' ? NaN : Number(p.start),
    endsAtMinute: p.end === '' ? NaN : Number(p.end),
    isActive: true,
  }))
  const fail = (message: string): never => {
    throw new Error(message)
  }
  if (opens === null || closes === null) {
    if (opens !== null || closes !== null || d.isActive || breaks.length || d.slots.length)
      fail('Defina abertura e encerramento, ou mantenha o dia fechado e sem intervalos/bloqueios.')
  } else {
    if (!hour(opens) || !hour(closes, true) || opens >= closes)
      fail('A abertura deve ser anterior ao encerramento, em horas cheias.')
    let end = opens
    for (const p of [...breaks].sort((a, b) => a.startsAtMinute - b.startsAtMinute)) {
      if (
        !hour(p.startsAtMinute) ||
        !hour(p.endsAtMinute, true) ||
        p.startsAtMinute >= p.endsAtMinute ||
        p.startsAtMinute < opens ||
        p.endsAtMinute > closes ||
        p.startsAtMinute < end
      )
        fail('Intervalos devem ficar dentro do expediente, sem sobreposição, em horas cheias.')
      end = p.endsAtMinute
    }
    if (d.slots.some((m) => !hour(m) || m < opens || m + 60 > closes))
      fail('Bloqueios semanais devem ficar dentro do expediente.')
  }
  if (breaks.length > 24 || new Set(d.slots).size !== d.slots.length)
    fail('Configuração duplicada ou com intervalos demais.')
  return {
    weekday,
    isActive: d.isActive,
    opensAtMinute: opens,
    closesAtMinute: closes,
    breaks,
    slotBlocks: d.slots.map((startsAtMinute) => ({ startsAtMinute, isBlocked: true })),
  }
}
export function exceptionInput(
  date: string,
  full: boolean,
  blocked: boolean,
  slots: number[],
  reason: string,
): ExceptionInput {
  if (!isLocalDate(date) || date < todayInSaoPaulo())
    throw new Error('Escolha uma data local de hoje ou futura para alterar bloqueios.')
  if (reason.trim().length > 500) throw new Error('O motivo deve ter até 500 caracteres.')
  if (
    !full &&
    (!slots.length || slots.some((m) => !hour(m)) || new Set(slots).size !== slots.length)
  )
    throw new Error('Selecione ao menos um horário válido, sem duplicações.')
  const detail = { isBlocked: blocked, ...(reason.trim() ? { reason: reason.trim() } : {}) }
  return full
    ? { localDate: date, dayBlock: detail }
    : {
        localDate: date,
        slotBlocks: [...slots]
          .sort((a, b) => a - b)
          .map((startsAtMinute) => ({ startsAtMinute, ...detail })),
      }
}
