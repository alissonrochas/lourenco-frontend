import { useEffect, useRef, type RefObject } from 'react'
import { Feedback } from '@/components/Feedback'
import { formatServicePrice } from '@/lib/adminService'
import type { ServiceInput } from '@/lib/adminService'

type Props = {
  input: Partial<ServiceInput>
  name: string
  creating: boolean
  pending: boolean
  wait: number
  error: string | null
  onClose: () => void
  onConfirm: () => void
  fallback: RefObject<HTMLElement | null>
  triggerFocus: RefObject<HTMLElement | null>
}
export function ServiceChangeDialog({
  input,
  name,
  creating,
  pending,
  wait,
  error,
  onClose,
  onConfirm,
  fallback,
  triggerFocus,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const element = dialog.current!
    const trigger = triggerFocus.current
    const heading = fallback.current
    element.showModal()
    back.current?.focus()
    return () => {
      element.close()
      if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus()
      else heading?.focus()
    }
  }, [fallback, triggerFocus])
  return (
    <dialog
      ref={dialog}
      className="cancel-dialog"
      aria-labelledby="service-confirm-title"
      aria-describedby="service-confirm-copy"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onClose()
      }}
    >
      <h3 id="service-confirm-title">
        {creating
          ? 'Cadastrar serviço?'
          : input.isActive === false
            ? 'Desativar serviço?'
            : input.isActive === true
              ? 'Ativar serviço?'
              : 'Salvar alterações do serviço?'}
      </h3>
      <p id="service-confirm-copy">
        {name}. As mudanças afetam a oferta para novos agendamentos. Reservas existentes mantêm os
        dados e preços históricos.{' '}
        {input.isActive === false && 'O serviço deixará de ser oferecido para novas reservas.'}
      </p>
      <dl className="booking-summary">
        {input.name !== undefined && (
          <div>
            <dt>Nome</dt>
            <dd>{input.name}</dd>
          </div>
        )}
        {input.description !== undefined && (
          <div>
            <dt>Descrição</dt>
            <dd>{input.description || 'Sem descrição'}</dd>
          </div>
        )}
        {input.priceCents !== undefined && (
          <div>
            <dt>Preço</dt>
            <dd>{formatServicePrice(input.priceCents)}</dd>
          </div>
        )}
        {input.durationMinutes !== undefined && (
          <div>
            <dt>Duração</dt>
            <dd>{input.durationMinutes} minutos</dd>
          </div>
        )}
        {input.isActive !== undefined && (
          <div>
            <dt>Estado</dt>
            <dd>{input.isActive ? 'Ativo' : 'Inativo'}</dd>
          </div>
        )}
      </dl>
      <Feedback message={error} error />
      <div className="booking-actions">
        <button
          ref={back}
          type="button"
          className="booking-secondary"
          disabled={pending}
          onClick={onClose}
        >
          Voltar sem salvar
        </button>
        <button
          type="button"
          className={input.isActive === false ? 'admin-danger' : 'booking-primary'}
          disabled={pending || wait > 0}
          onClick={onConfirm}
        >
          {pending ? 'Salvando…' : wait ? `Aguarde ${wait}s` : 'Confirmar alteração'}
        </button>
      </div>
    </dialog>
  )
}
