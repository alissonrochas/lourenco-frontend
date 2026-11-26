import { useState, useId, type FormEvent } from 'react'
import { Feedback } from '@/components/Feedback'
import {
  hours,
  weekdays,
  weeklyDraft,
  weeklyPatch,
  exceptionInput,
  type ScheduleDay,
  type DayPatch,
  type ExceptionInput,
} from '@/lib/adminSchedule'
import { formatDate, formatTime, todayInSaoPaulo } from '@/lib/booking'

export function HourSelect({
  label,
  value,
  end = false,
  onChange,
}: {
  label: string
  value: string
  end?: boolean
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="schedule-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Não definido</option>
        {(end ? [...hours.slice(1), 1440] : hours).map((m) => (
          <option key={m} value={m}>
            {formatTime(m)}
          </option>
        ))}
      </select>
    </div>
  )
}
export function WeeklyScheduleForm({
  day,
  disabled,
  onReview,
}: {
  day: ScheduleDay
  disabled: boolean
  onReview: (input: DayPatch, summary: string) => void
}) {
  const [draft, setDraft] = useState(() => weeklyDraft(day)),
    [error, setError] = useState<string | null>(null)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (disabled) return
    try {
      const input = weeklyPatch(day.weekday, draft)
      setError(null)
      onReview(
        input,
        `${weekdays[day.weekday - 1]}: ${input.isActive ? `aberto de ${formatTime(input.opensAtMinute!)} a ${formatTime(input.closesAtMinute!)}` : 'fechado'}. ${input.breaks.length} intervalo(s) e ${input.slotBlocks.length} bloqueio(s) semanal(is).`,
      )
    } catch (failure) {
      setError((failure as Error).message)
    }
  }
  return (
    <form
      aria-label="Configurar dia semanal"
      className="schedule-form"
      onSubmit={submit}
      noValidate
    >
      <fieldset disabled={disabled}>
        <legend>{weekdays[day.weekday - 1]}</legend>
        <label className="service-check">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
          />
          Atendimento ativo neste dia
        </label>
        <div className="service-numbers">
          <HourSelect
            label="Abertura"
            value={draft.opens}
            onChange={(opens) => setDraft({ ...draft, opens })}
          />
          <HourSelect
            label="Encerramento"
            value={draft.closes}
            end
            onChange={(closes) => setDraft({ ...draft, closes })}
          />
        </div>
        <p className="booking-note">
          Horas cheias. 24:00 é o encerramento no início do dia seguinte. Fechar preserva a
          configuração; nenhum horário é inventado.
        </p>
        <h5>Intervalos sem atendimento</h5>
        {draft.breaks.length === 0 && (
          <p className="booking-note">Sem intervalos ativos neste dia.</p>
        )}
        {draft.breaks.map((pause, i) => (
          <div className="schedule-pause" key={i}>
            <HourSelect
              label={`Início do intervalo ${i + 1}`}
              value={pause.start}
              onChange={(start) =>
                setDraft({
                  ...draft,
                  breaks: draft.breaks.map((p, j) => (i === j ? { ...p, start } : p)),
                })
              }
            />
            <HourSelect
              label={`Fim do intervalo ${i + 1}`}
              value={pause.end}
              end
              onChange={(end) =>
                setDraft({
                  ...draft,
                  breaks: draft.breaks.map((p, j) => (i === j ? { ...p, end } : p)),
                })
              }
            />
            <button
              type="button"
              className="booking-text-button"
              onClick={() => setDraft({ ...draft, breaks: draft.breaks.filter((_, j) => j !== i) })}
            >
              Remover intervalo {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="booking-secondary"
          disabled={draft.breaks.length >= 24}
          onClick={() => setDraft({ ...draft, breaks: [...draft.breaks, { start: '', end: '' }] })}
        >
          Adicionar intervalo
        </button>
        <h5>Bloqueios semanais de uma hora</h5>
        <div className="schedule-hours">
          {hours.map((m) => (
            <label key={m}>
              <input
                type="checkbox"
                aria-label={`Bloqueio semanal ${formatTime(m)}`}
                checked={draft.slots.includes(m)}
                disabled={
                  !draft.slots.includes(m) &&
                  (draft.opens === '' ||
                    draft.closes === '' ||
                    m < Number(draft.opens) ||
                    m + 60 > Number(draft.closes))
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    slots: e.target.checked
                      ? [...draft.slots, m]
                      : draft.slots.filter((v) => v !== m),
                  })
                }
              />
              {formatTime(m)}
            </label>
          ))}
        </div>
        <Feedback message={error} error />
        <button type="submit" className="booking-primary">
          Revisar dia semanal
        </button>
      </fieldset>
    </form>
  )
}
export function DateExceptionForm({
  date,
  disabled,
  onReview,
}: {
  date: string
  disabled: boolean
  onReview: (input: ExceptionInput, summary: string) => void
}) {
  const [full, setFull] = useState(true),
    [blocked, setBlocked] = useState(true),
    [slots, setSlots] = useState<number[]>([]),
    [reason, setReason] = useState(''),
    [error, setError] = useState<string | null>(null)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (disabled) return
    try {
      const input = exceptionInput(date, full, blocked, slots, reason)
      setError(null)
      onReview(
        input,
        `${blocked ? 'Bloquear' : 'Liberar bloqueio de'} ${formatDate(date)}: ${full ? 'dia inteiro' : slots.map((m) => `${formatTime(m)}–${formatTime(m + 60)}`).join(', ')}.${reason.trim() ? ` Motivo: ${reason.trim()}` : ''}`,
      )
    } catch (failure) {
      setError((failure as Error).message)
    }
  }
  return (
    <form
      aria-label="Configurar bloqueios por data"
      className="schedule-form"
      onSubmit={submit}
      noValidate
    >
      <fieldset disabled={disabled || date < todayInSaoPaulo()}>
        <legend>Alterar bloqueios de {formatDate(date)}</legend>
        <div className="service-numbers">
          <div className="schedule-field">
            <label htmlFor="schedule-operation">Operação</label>
            <select
              id="schedule-operation"
              value={blocked ? 'block' : 'release'}
              onChange={(e) => setBlocked(e.target.value === 'block')}
            >
              <option value="block">Bloquear</option>
              <option value="release">Liberar bloqueio</option>
            </select>
          </div>
          <div className="schedule-field">
            <label htmlFor="schedule-scope">Abrangência</label>
            <select
              id="schedule-scope"
              value={full ? 'day' : 'slots'}
              onChange={(e) => setFull(e.target.value === 'day')}
            >
              <option value="day">Dia inteiro</option>
              <option value="slots">Horários selecionados</option>
            </select>
          </div>
        </div>
        {!full && (
          <div className="schedule-hours">
            {hours.map((m) => (
              <label key={m}>
                <input
                  type="checkbox"
                  aria-label={`Horário excepcional ${formatTime(m)}`}
                  checked={slots.includes(m)}
                  onChange={(e) =>
                    setSlots(e.target.checked ? [...slots, m] : slots.filter((v) => v !== m))
                  }
                />
                {formatTime(m)}–{formatTime(m + 60)}
              </label>
            ))}
          </div>
        )}
        <div className="schedule-field">
          <label htmlFor="schedule-reason">Motivo administrativo (opcional)</label>
          <textarea
            id="schedule-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </div>
        <p className="booking-note">
          Até 500 caracteres. Em branco preserva o motivo existente. Não será exibido ao público.
          Alterações de datas passadas ficam indisponíveis nesta interface.
        </p>
        <Feedback message={error} error />
        <button type="submit" className="booking-primary">
          Revisar bloqueios da data
        </button>
      </fieldset>
    </form>
  )
}
