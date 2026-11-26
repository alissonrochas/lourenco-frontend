import { expect, it } from 'vitest'
import {
  weeklyPatch,
  weeklyDraft,
  exceptionInput,
  validWeekly,
  validExceptions,
  type ScheduleDay,
} from './adminSchedule'
const day: ScheduleDay = {
  weekday: 1,
  isConfigured: true,
  isActive: true,
  opensAtMinute: 540,
  closesAtMinute: 1080,
  breaks: [{ startsAtMinute: 720, endsAtMinute: 780, isActive: true }],
  slotBlocks: [{ startsAtMinute: 600, isBlocked: true }],
}
it('round-trips only editable weekly fields and filters historical inactive children', () => {
  const draft = weeklyDraft({
    ...day,
    breaks: [...day.breaks, { startsAtMinute: 0, endsAtMinute: 60, isActive: false }],
  })
  expect(weeklyPatch(1, draft)).toEqual({
    weekday: 1,
    isActive: true,
    opensAtMinute: 540,
    closesAtMinute: 1080,
    breaks: day.breaks,
    slotBlocks: day.slotBlocks,
  })
  expect(weeklyPatch(1, { isActive: false, opens: '', closes: '', breaks: [], slots: [] })).toEqual(
    {
      weekday: 1,
      isActive: false,
      opensAtMinute: null,
      closesAtMinute: null,
      breaks: [],
      slotBlocks: [],
    },
  )
})
it.each([
  { opens: '541' },
  { closes: '540' },
  { opens: '-60' },
  { closes: '1500' },
  { opens: '' },
  {
    breaks: [
      { start: '720', end: '840' },
      { start: '780', end: '900' },
    ],
  },
  { breaks: [{ start: '480', end: '600' }] },
  { breaks: [{ start: '720', end: '720' }] },
  { slots: [600, 600] },
  { slots: [1080] },
])('rejects invalid weekly changes %j', (change) =>
  expect(() => weeklyPatch(1, { ...weeklyDraft(day), ...change })).toThrow(),
)
it('allows adjacent pauses, midnight, and closing at 24:00', () => {
  const result = weeklyPatch(7, {
    isActive: true,
    opens: '0',
    closes: '1440',
    breaks: [
      { start: '60', end: '120' },
      { start: '120', end: '180' },
    ],
    slots: [1380],
  })
  expect(result.closesAtMinute).toBe(1440)
})
it('creates date operations without IDs, normalizes reason and preserves omitted reasons', () => {
  expect(exceptionInput('2099-12-25', true, true, [], ' Folga ')).toEqual({
    localDate: '2099-12-25',
    dayBlock: { isBlocked: true, reason: 'Folga' },
  })
  expect(exceptionInput('2099-12-25', false, false, [960, 600], ' ')).toEqual({
    localDate: '2099-12-25',
    slotBlocks: [
      { startsAtMinute: 600, isBlocked: false },
      { startsAtMinute: 960, isBlocked: false },
    ],
  })
})
it.each(['2027-02-29', '1900-02-29', '2099-04-31', '2099-1-01', '2000-01-01'])(
  'rejects invalid/past local date %s',
  (date) => expect(() => exceptionInput(date, true, true, [], '')).toThrow(),
)
it('accepts a future leap date', () =>
  expect(exceptionInput('2028-02-29', true, true, [], '').localDate).toBe('2028-02-29'))
it.each([[], [601], [1440], [600, 600]])(
  'rejects partial exception hours %j',
  (...slots: number[]) =>
    expect(() => exceptionInput('2099-12-25', false, true, slots, '')).toThrow(),
)
it('rejects an overlong reason', () =>
  expect(() => exceptionInput('2099-12-25', true, true, [], 'x'.repeat(501))).toThrow())
it('checks response types and fixed timezone/duration', () => {
  const weekly = {
    timezone: 'America/Sao_Paulo',
    slotDurationMinutes: 60,
    days: Array.from({ length: 7 }, (_, i) => ({ ...day, weekday: i + 1 })),
  }
  expect(validWeekly(weekly)).toBe(true)
  expect(validWeekly({ ...weekly, slotDurationMinutes: 45 })).toBe(false)
  expect(validWeekly({ ...weekly, timezone: 'UTC' })).toBe(false)
  expect(validExceptions({ dateBlocks: [], slotBlocks: [] }, '2099-12-25')).toBe(true)
  expect(
    validExceptions({ dateBlocks: [{ localDate: '2099-12-24' }], slotBlocks: [] }, '2099-12-25'),
  ).toBe(false)
})
