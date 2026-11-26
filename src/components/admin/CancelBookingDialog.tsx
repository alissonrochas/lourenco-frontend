import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'
import { Feedback } from '@/components/Feedback'
import { formatDate, formatTime } from '@/lib/booking'
import type { AdminBooking } from '@/lib/adminBooking'

type Props = {
  booking: AdminBooking
  pending: boolean
  eligible: boolean
  wait: number
  error: string | null
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
  fallbackFocus: RefObject<HTMLElement | null>
  triggerFocus: RefObject<HTMLElement | null>
}
export function CancelBookingDialog({
  booking,
  pending,
  eligible,
  wait,
  error,
  onClose,
  onConfirm,
  fallbackFocus,
  triggerFocus,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [reason, setReason] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  useEffect(() => {
    const element = dialog.current!
    const trigger =
      triggerFocus.current ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null)
    element.showModal()
    input.current?.focus()
    const fallback = fallbackFocus.current
    return () => {
      element.close()
      if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus()
      else fallback?.focus()
    }
  }, [fallbackFocus, triggerFocus])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || !eligible || wait > 0) return
    if (!reason.trim() || reason.trim().length > 500) {
      setValidation('Informe um motivo com 1 a 500 caracteres.')
      input.current?.focus()
      return
    }
    setValidation(null)
    await onConfirm(reason)
  }
  return (
    <dialog
      ref={dialog}
      className="cancel-dialog"
      aria-labelledby="cancel-title"
      aria-describedby="cancel-description"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onClose()
      }}
    >
      <form onSubmit={submit} noValidate aria-label="Confirmar cancelamento">
        <p className="booking-eyebrow">Cancelamento administrativo</p>
        <h3 id="cancel-title">Cancelar reserva #{booking.id}?</h3>
        <p id="cancel-description">
          {booking.customer.name} · {booking.serviceName}
          <br />
          {formatDate(booking.localDate)} às{' '}
          {formatTime(booking.startsAtMinute)}. O registro continuará no
          histórico.
        </p>
        <label htmlFor="cancel-reason">Motivo do cancelamento</label>
        <textarea
          id="cancel-reason"
          ref={input}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          required
          disabled={pending}
          rows={4}
          aria-invalid={!!validation}
          aria-describedby="reason-hint"
        />
        <p id="reason-hint" className="booking-note">
          Obrigatório. Até 500 caracteres. A primeira auditoria será preservada.
        </p>
        <Feedback
          message={
            !eligible && !pending
              ? 'Esta reserva já começou. Feche o diálogo e atualize a lista.'
              : validation || error
          }
          error
        />
        <div className="booking-actions">
          <button
            type="button"
            className="booking-secondary"
            onClick={onClose}
            disabled={pending}
          >
            Manter reserva
          </button>
          <button
            type="submit"
            className="admin-danger"
            disabled={pending || !eligible || wait > 0}
          >
            {pending
              ? 'Cancelando…'
              : wait > 0
                ? `Aguarde ${wait}s`
                : 'Confirmar cancelamento'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
