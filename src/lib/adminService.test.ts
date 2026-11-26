import { describe, expect, it } from 'vitest'
import {
  emptyServiceDraft,
  formatServicePrice,
  isAdminService,
  priceText,
  serviceChanges,
  validateService,
} from './adminService'
const draft = { ...emptyServiceDraft, name: ' Corte ', price: '45,90', duration: '45' }
describe('service form contract', () => {
  it('formats maximum safe cents without losing the last cent', () =>
    expect(formatServicePrice(Number.MAX_SAFE_INTEGER)).toContain('90.071.992.547.409,91'))
  it('normalizes strings, null description, strict numbers and boolean', () => {
    expect(validateService(draft).data).toEqual({
      name: 'Corte',
      description: null,
      priceCents: 4590,
      durationMinutes: 45,
      isActive: true,
    })
  })
  it.each(['0', '0,01', '1.10', '90071992547409,91'])('converts exact cents for %s', (price) => {
    const result = validateService({ ...draft, price })
    expect(result.data).toBeDefined()
    expect(
      validateService({ ...draft, price: priceText(result.data!.priceCents) }).data?.priceCents,
    ).toBe(result.data?.priceCents)
  })
  it.each(['', '-1', '1,001', '1.000,00', '1e2', 'Infinity', '90071992547409,92'])(
    'rejects price %s',
    (price) => expect(validateService({ ...draft, price }).error).toBeTruthy(),
  )
  it.each(['4', '481', '5.5', '', '-10'])('rejects duration %s', (duration) =>
    expect(validateService({ ...draft, duration }).error).toBeTruthy(),
  )
  it.each([{ name: 'A' }, { name: 'x'.repeat(121) }, { description: 'x'.repeat(1001) }])(
    'rejects invalid text %j',
    (change) => expect(validateService({ ...draft, ...change }).error).toBeTruthy(),
  )
  it('produces only changed editable fields including explicit null/false', () => {
    const data = validateService(draft).data!
    const before = { ...data, id: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: null }
    expect(isAdminService(before)).toBe(true)
    expect(serviceChanges(before, { ...data, description: 'Nova' })).toEqual({
      description: 'Nova',
    })
    expect(
      serviceChanges({ ...before, description: 'Antiga' }, { ...data, isActive: false }),
    ).toEqual({ description: null, isActive: false })
    expect(serviceChanges(before, data)).toEqual({})
    expect(isAdminService({ ...before, isActive: 1 })).toBe(false)
  })
})
