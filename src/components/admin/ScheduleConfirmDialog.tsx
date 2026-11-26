import { useEffect, useRef, type RefObject } from 'react'
import { Feedback } from '@/components/Feedback'
export function ScheduleConfirmDialog({
  summary,
  pending,
  wait,
  error,
  trigger,
  fallback,
  onClose,
  onConfirm,
}: {
  summary: string
  pending: boolean
  wait: number
  error: string | null
  trigger: RefObject<HTMLElement | null>
  fallback: RefObject<HTMLElement | null>
  onClose: () => void
  onConfirm: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const element = dialog.current!,
      origin = trigger.current,
      heading = fallback.current
    element.showModal()
    back.current?.focus()
    return () => {
      element.close()
      if (origin?.isConnected && !origin.matches(':disabled')) origin.focus()
      else heading?.focus()
    }
  }, [trigger, fallback])
  return (
    <dialog
      ref={dialog}
      className="cancel-dialog"
      aria-labelledby="schedule-confirm-title"
      aria-describedby="schedule-confirm-copy"
      onCancel={(e) => {
        e.preventDefault()
        if (!pending) onClose()
      }}
    >
      <h3 id="schedule-confirm-title">Confirmar alteração do calendário?</h3>
      <p>{summary}</p>
      <p id="schedule-confirm-copy">
        Esta alteração afeta novos agendamentos. Reservas confirmadas não serão canceladas nem
        modificadas. Se houver conflito, o servidor recusará a alteração inteira. Liberar um
        bloqueio não abre dia fechado, não ignora intervalos ou outros bloqueios e não libera
        horários ocupados.
      </p>
      <Feedback message={error} error />
      <div className="booking-actions">
        <button
          ref={back}
          type="button"
          className="booking-secondary"
          disabled={pending}
          onClick={onClose}
        >
          Voltar sem alterar
        </button>
        <button
          type="button"
          className="booking-primary"
          disabled={pending || wait > 0}
          onClick={onConfirm}
        >
          {pending ? 'Salvando…' : wait ? `Aguarde ${wait}s` : 'Confirmar calendário'}
        </button>
      </div>
    </dialog>
  )
}
