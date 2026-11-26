import { useRef, useState, type FormEvent } from 'react'
import { Feedback } from '@/components/Feedback'
import { useAdminSchedule } from '@/hooks/useAdminSchedule'
import { useRetryCountdown } from '@/hooks/useRetryCountdown'
import { weekdays, type DayPatch, type ExceptionInput } from '@/lib/adminSchedule'
import { formatDate, formatTime, todayInSaoPaulo } from '@/lib/booking'
import { WeeklyScheduleForm, DateExceptionForm } from './ScheduleForms'
import { ScheduleConfirmDialog } from './ScheduleConfirmDialog'
export function ScheduleDashboard({
  onDenied,
  onBusy,
}: {
  onDenied: (failure: unknown) => void
  onBusy: (busy: boolean) => void
}) {
  const flow = useAdminSchedule(onDenied, onBusy),
    wait = useRetryCountdown(flow.retryAt)
  const [weekday, setWeekday] = useState(1),
    [queryDate, setQueryDate] = useState(todayInSaoPaulo)
  const [review, setReview] = useState<{
    kind: 'weekly' | 'date'
    input: DayPatch | ExceptionInput
    summary: string
  } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLElement | null>(null)
  const disabled =
    flow.pending || flow.loading || !flow.data || flow.needsRefresh || wait > 0 || !!review
  function prepare(kind: 'weekly' | 'date', input: DayPatch | ExceptionInput, summary: string) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setReview({ kind, input, summary })
  }
  async function confirm() {
    if (review && (await flow.save(review.kind, review.input))) setReview(null)
  }
  function consult(e: FormEvent) {
    e.preventDefault()
    if (!flow.pending) {
      setReview(null)
      flow.refresh(queryDate)
    }
  }
  return (
    <section className="admin-dashboard" aria-labelledby="schedule-title">
      <header className="admin-agenda-heading">
        <div>
          <p className="booking-eyebrow">Funcionamento da barbearia</p>
          <h3 id="schedule-title" ref={heading} tabIndex={-1}>
            Horários
          </h3>
          <p className="booking-note">
            America/Sao_Paulo · blocos fixos de 60 minutos · horas cheias
          </p>
        </div>
        <button
          type="button"
          className="booking-secondary"
          disabled={flow.pending || wait > 0}
          onClick={() => {
            setReview(null)
            flow.refresh()
          }}
        >
          {wait ? `Aguarde ${wait}s para recarregar` : 'Recarregar calendário'}
        </button>
      </header>
      <p className="booking-note">
        Recarregar, consultar outra data ou trocar o dia semanal descarta o formulário não salvo. A
        disponibilidade pública sempre é calculada pelo servidor.
      </p>
      <Feedback message={flow.notice} />
      {!review && <Feedback message={flow.error} error />}
      {flow.loading && <p role="status">Carregando calendário…</p>}
      {flow.needsRefresh && (
        <p role="status">
          Recarregue e confira o estado do calendário antes de outra operação. Nada será reenviado
          automaticamente.
        </p>
      )}
      {flow.data && (
        <div className="schedule-area">
          <h4>Funcionamento semanal</h4>
          <label className="schedule-field">
            Dia da semana
            <select
              disabled={disabled}
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
            >
              {weekdays.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <WeeklyScheduleForm
            key={`${weekday}:${flow.data.weekly.tag}`}
            day={flow.data.weekly.data.days[weekday - 1]}
            disabled={disabled}
            onReview={(input, summary) => prepare('weekly', input, summary)}
          />
        </div>
      )}
      <div className="schedule-area">
        <h4>Bloqueios por data</h4>
        <form
          className="schedule-query"
          onSubmit={consult}
          aria-label="Consultar bloqueios por data"
          noValidate
        >
          <label className="schedule-field">
            Data dos bloqueios
            <input
              type="date"
              value={queryDate}
              onChange={(e) => setQueryDate(e.target.value)}
              disabled={flow.pending || wait > 0}
              required
            />
          </label>
          <button type="submit" className="booking-secondary" disabled={flow.pending || wait > 0}>
            Consultar data
          </button>
        </form>
        {flow.data && (
          <>
            <h5>Registros de {formatDate(flow.date)}</h5>
            {!flow.data.dates.data.dateBlocks.length && !flow.data.dates.data.slotBlocks.length && (
              <p role="status">Nenhum bloqueio excepcional registrado nesta data.</p>
            )}
            <ul className="schedule-records" aria-label="Bloqueios registrados">
              {flow.data.dates.data.dateBlocks.map((r) => (
                <li key={`day-${r.id}`}>
                  <strong>Dia inteiro · {r.isBlocked ? 'Bloqueado' : 'Liberado'}</strong>
                  {r.reason && <p>{r.reason}</p>}
                </li>
              ))}
              {flow.data.dates.data.slotBlocks.map((r) => (
                <li key={`slot-${r.id}`}>
                  <strong>
                    {formatTime(r.startsAtMinute)}–{formatTime(r.startsAtMinute + 60)} ·{' '}
                    {r.isBlocked ? 'Bloqueado' : 'Liberado'}
                  </strong>
                  {r.reason && <p>{r.reason}</p>}
                </li>
              ))}
            </ul>
            <DateExceptionForm
              key={`${flow.date}:${flow.data.dates.tag}`}
              date={flow.date}
              disabled={disabled}
              onReview={(input, summary) => prepare('date', input, summary)}
            />
          </>
        )}
      </div>
      {review && (
        <ScheduleConfirmDialog
          summary={review.summary}
          pending={flow.pending}
          wait={wait}
          error={flow.error}
          trigger={trigger}
          fallback={heading}
          onClose={() => setReview(null)}
          onConfirm={() => void confirm()}
        />
      )}
    </section>
  )
}
