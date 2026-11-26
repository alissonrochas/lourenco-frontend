import type { PublicService } from './booking'

export type AdminService = PublicService
export type ServiceInput = Pick<
  AdminService,
  'name' | 'description' | 'priceCents' | 'durationMinutes' | 'isActive'
>
export type ServiceDraft = {
  name: string
  description: string
  price: string
  duration: string
  isActive: boolean
}
export const emptyServiceDraft: ServiceDraft = {
  name: '',
  description: '',
  price: '',
  duration: '60',
  isActive: true,
}

export function isAdminService(value: unknown): value is AdminService {
  if (!value || typeof value !== 'object') return false
  const s = value as AdminService
  return (
    Number.isSafeInteger(s.id) &&
    s.id > 0 &&
    typeof s.name === 'string' &&
    s.name.trim().length >= 2 &&
    s.name.length <= 120 &&
    (s.description === null ||
      (typeof s.description === 'string' && s.description.length <= 1000)) &&
    Number.isSafeInteger(s.priceCents) &&
    s.priceCents >= 0 &&
    Number.isInteger(s.durationMinutes) &&
    s.durationMinutes >= 5 &&
    s.durationMinutes <= 480 &&
    typeof s.isActive === 'boolean' &&
    typeof s.createdAt === 'string' &&
    Number.isFinite(Date.parse(s.createdAt)) &&
    (s.updatedAt === null ||
      (typeof s.updatedAt === 'string' && Number.isFinite(Date.parse(s.updatedAt))))
  )
}
export function priceText(cents: number) {
  const value = BigInt(cents)
  return `${value / 100n},${String(value % 100n).padStart(2, '0')}`
}
export function serviceDraft(service: AdminService): ServiceDraft {
  return {
    name: service.name,
    description: service.description ?? '',
    price: priceText(service.priceCents),
    duration: String(service.durationMinutes),
    isActive: service.isActive,
  }
}
export function validateService(
  draft: ServiceDraft,
): { data: ServiceInput; error?: never } | { error: string; data?: never } {
  const name = draft.name.trim(),
    description = draft.description.trim()
  if (name.length < 2 || name.length > 120)
    return { error: 'Informe um nome com 2 a 120 caracteres.' }
  if (description.length > 1000) return { error: 'A descrição deve ter até 1.000 caracteres.' }
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(draft.price.trim()))
    return {
      error:
        'Informe um preço não negativo, com até duas casas decimais, sem separador de milhares.',
    }
  const [whole, fraction = ''] = draft.price.trim().split(/[,.]/)
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    return { error: 'O preço excede o limite permitido.' }
  if (!/^\d+$/.test(draft.duration) || Number(draft.duration) < 5 || Number(draft.duration) > 480)
    return { error: 'Informe uma duração inteira entre 5 e 480 minutos.' }
  return {
    data: {
      name,
      description: description || null,
      priceCents: Number(cents),
      durationMinutes: Number(draft.duration),
      isActive: draft.isActive,
    },
  }
}
export function serviceChanges(before: AdminService, after: ServiceInput): Partial<ServiceInput> {
  const patch: Partial<ServiceInput> = {}
  if (before.name !== after.name) patch.name = after.name
  if (before.description !== after.description) patch.description = after.description
  if (before.priceCents !== after.priceCents) patch.priceCents = after.priceCents
  if (before.durationMinutes !== after.durationMinutes)
    patch.durationMinutes = after.durationMinutes
  if (before.isActive !== after.isActive) patch.isActive = after.isActive
  return patch
}

// Format safe integer cents without rounding through a floating point amount in reais.
export function formatServicePrice(cents: number) {
  const value = BigInt(cents)
  const whole = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value / 100n)
  return `${whole},${String(value % 100n).padStart(2, '0')}`
}
