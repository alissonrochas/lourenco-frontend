import { useState, type FormEvent } from 'react'
import { FormField } from '@/components/FormField'
import { Feedback } from '@/components/Feedback'
import {
  emptyServiceDraft,
  serviceDraft,
  serviceChanges,
  validateService,
  type AdminService,
  type ServiceInput,
} from '@/lib/adminService'

export function ServiceEditor({
  service,
  disabled,
  onReview,
  onClose,
}: {
  service: AdminService | null
  disabled: boolean
  onReview: (input: Partial<ServiceInput>) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() =>
    service ? serviceDraft(service) : { ...emptyServiceDraft },
  )
  const [error, setError] = useState<string | null>(null)
  function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled) return
    const result = validateService(draft)
    if (!result.data) {
      setError(result.error)
      return
    }
    const input = service ? serviceChanges(service, result.data) : result.data
    if (!Object.keys(input).length) {
      setError('Nenhuma alteração foi informada.')
      return
    }
    setError(null)
    onReview(input)
  }
  return (
    <form
      className="service-editor"
      aria-label={service ? 'Editar serviço' : 'Cadastrar serviço'}
      onSubmit={submit}
      noValidate
    >
      <h4>{service ? `Editar ${service.name}` : 'Novo serviço'}</h4>
      <p className="booking-note">
        Preço em reais. A duração descreve o serviço; a agenda do MVP continua usando blocos de 60
        minutos.
      </p>
      <fieldset disabled={disabled}>
        <legend className="sr-only">Dados do serviço</legend>
        <FormField
          id="service-name"
          label="Nome do serviço"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          maxLength={120}
          required
        />
        <div>
          <label htmlFor="service-description">Descrição (opcional)</label>
          <textarea
            id="service-description"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            maxLength={1000}
            rows={3}
          />
        </div>
        <div className="service-numbers">
          <FormField
            id="service-price"
            label="Preço (R$)"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            inputMode="decimal"
            aria-describedby="service-price-hint"
            maxLength={30}
            required
          />
          <FormField
            id="service-duration"
            label="Duração (minutos)"
            value={draft.duration}
            onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
            inputMode="numeric"
            maxLength={3}
            required
          />
        </div>
        <p id="service-price-hint" className="booking-note">
          Exemplo: 45,90. Até duas casas decimais, sem separador de milhares. Duração de 5 a 480
          minutos.
        </p>
        <label className="service-check">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
          />
          Ativo para novos agendamentos
        </label>
        <Feedback message={error} error />
        <div className="booking-actions">
          <button type="button" className="booking-secondary" onClick={onClose}>
            Fechar formulário
          </button>
          <button type="submit" className="booking-primary">
            Revisar alterações
          </button>
        </div>
      </fieldset>
    </form>
  )
}
