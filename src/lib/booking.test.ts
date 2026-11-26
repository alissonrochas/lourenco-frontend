import { afterEach, expect, it, vi } from 'vitest'
import { contactError, formatDate, formatTime, isLocalDate, todayInSaoPaulo } from './booking'
afterEach(() => vi.useRealTimers())
it('uses the barber calendar rather than the UTC date at midnight boundaries', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-27T01:30:00Z'))
  expect(todayInSaoPaulo()).toBe('2026-11-26')
})
it('validates real local dates and formats dates/minutes without shifting them', () => {
  expect(isLocalDate('2028-02-29')).toBe(true)
  for (const value of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-1-01', '0000-01-01']) expect(isLocalDate(value)).toBe(false)
  expect(formatDate('2028-02-29')).toBe('29/02/2028')
  expect(formatTime(0)).toBe('00:00')
  expect(formatTime(1440)).toBe('24:00')
})
it('matches basic customer contact limits without claiming ownership of the phone', () => {
  expect(contactError('Cliente', '+55 (71) 99999-9999')).toBeNull()
  expect(contactError('a'.repeat(121), '71999999999')).toContain('nome')
  expect(contactError('Cliente', '1'.repeat(16))).toContain('telefone')
})
