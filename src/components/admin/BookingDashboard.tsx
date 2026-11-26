import { useRef, useState, type FormEvent } from 'react'
import { Feedback } from '@/components/Feedback'
import { FormField } from '@/components/FormField'
import { useAdminBookings } from '@/hooks/useAdminBookings'
import { useRetryCountdown } from '@/hooks/useRetryCountdown'
import { adjacentDate, canCancel, rangeError } from '@/lib/adminBooking'
import {
  formatDate,
  formatPrice,
  formatTime,
  todayInSaoPaulo,
} from '@/lib/booking'
import { CancelBookingDialog } from './CancelBookingDialog'

export function BookingDashboard({
  onDenied,
}: {
  onDenied: (error: unknown) => void
}) {
  const flow = useAdminBookings(onDenied)
  const [from, setFrom] = useState(flow.query.from)
  const [to, setTo] = useState(flow.query.to)
  const [perPage, setPerPage] = useState(flow.query.perPage)
  const [filterError, setFilterError] = useState<string | null>(null)
  const focusTarget = useRef<HTMLHeadingElement>(null)
  const cancelTrigger = useRef<HTMLButtonElement>(null)
  const listWait = useRetryCountdown(flow.listRetryAt)
  const cancelWait = useRetryCountdown(flow.cancelRetryAt)
  function apply(event: FormEvent) {
    event.preventDefault()
    const failure = rangeError(from, to)
    setFilterError(failure)
    if (!failure) flow.refresh({ from, to, page: 1, perPage })
  }
  function day(direction: -1 | 1 | 0) {
    const date =
      direction === 0
        ? todayInSaoPaulo()
        : adjacentDate(flow.query.from, direction)
    if (!date) return
    setFrom(date)
    setTo(date)
    setFilterError(null)
    flow.refresh({ ...flow.query, from: date, to: date, page: 1 })
  }
  const blocked = flow.pending || listWait > 0
  return (
    <section className="admin-dashboard" aria-labelledby="reservations-title">
      <header className="admin-agenda-heading">
        <div>
          <p className="booking-eyebrow">Agenda da barbearia</p>
          <h3 ref={focusTarget} tabIndex={-1} id="reservations-title">
            Reservas
          </h3>
          <p className="booking-note">
            Hoje: {formatDate(todayInSaoPaulo())} · America/Sao_Paulo
          </p>
        </div>
        <button
          type="button"
          className="booking-secondary"
          disabled={blocked || flow.loading}
          onClick={() => flow.refresh()}
        >
          {listWait ? `Aguarde ${listWait}s para atualizar` : 'Atualizar lista'}
        </button>
      </header>
      <form
        onSubmit={apply}
        className="agenda-filters"
        aria-label="Filtrar reservas"
        noValidate
      >
        <fieldset disabled={blocked}>
          <legend className="sr-only">Período e tamanho da página</legend>
          <FormField
            id="agenda-from"
            label="De"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            required
          />
          <FormField
            id="agenda-to"
            label="Até"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            required
          />
          <div>
            <label htmlFor="agenda-size">Por página</label>
            <select
              id="agenda-size"
              value={perPage}
              onChange={(event) => setPerPage(Number(event.target.value))}
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <button className="booking-primary" type="submit">
            Consultar período
          </button>
        </fieldset>
      </form>
      <Feedback message={filterError} error />
      <nav aria-label="Navegar entre dias" className="agenda-days">
        <button
          type="button"
          disabled={blocked || !adjacentDate(flow.query.from, -1)}
          onClick={() => day(-1)}
        >
          Dia anterior
        </button>
        <button type="button" disabled={blocked} onClick={() => day(0)}>
          Hoje
        </button>
        <button
          type="button"
          disabled={blocked || !adjacentDate(flow.query.from, 1)}
          onClick={() => day(1)}
        >
          Dia seguinte
        </button>
      </nav>
      <p className="agenda-period">
        {formatDate(flow.query.from)} a {formatDate(flow.query.to)}
        {flow.data && (
          <strong> · {flow.data.meta.total} reservas no período</strong>
        )}
      </p>
      <Feedback message={flow.notice} />
      {!flow.selected && <Feedback message={flow.error} error />}
      {flow.needsRefresh && (
        <p className="booking-note">
          A consulta precisa ser atualizada antes de outro cancelamento. Nenhuma
          tentativa será reenviada automaticamente.
        </p>
      )}
      {flow.loading && <p role="status">Carregando reservas…</p>}
      {flow.data?.data.length === 0 && (
        <p role="status">Nenhuma reserva nesta página do período consultado.</p>
      )}
      <ul
        className="agenda-list"
        aria-label="Reservas do período"
        aria-busy={flow.loading}
      >
        {flow.data?.data.map((booking) => (
          <li key={booking.id} className="agenda-card">
            <div className="agenda-card-heading">
              <div>
                <p className="agenda-time">
                  {formatTime(booking.startsAtMinute)}{' '}
                  <span>até {booking.endsAtLocal.slice(11, 16)}</span>
                </p>
                <p className="booking-note">
                  {formatDate(booking.localDate)} · #{booking.id}
                </p>
              </div>
              <span className={`agenda-status ${booking.status}`}>
                {booking.status === 'confirmed' ? 'Confirmada' : 'Cancelada'}
              </span>
            </div>
            <dl className="agenda-details">
              <div>
                <dt>Cliente</dt>
                <dd>{booking.customer.name}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{booking.customer.phone}</dd>
              </div>
              <div>
                <dt>Serviço registrado</dt>
                <dd>{booking.serviceName}</dd>
              </div>
              <div>
                <dt>Preço registrado</dt>
                <dd>{formatPrice(booking.priceCents)}</dd>
              </div>
            </dl>
            {booking.cancellation && (
              <details className="agenda-audit">
                <summary>
                  Detalhes do cancelamento da reserva #{booking.id}
                </summary>
                <p>{booking.cancellation.reason}</p>
                <p>
                  Em{' '}
                  {new Intl.DateTimeFormat('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(booking.cancellation.cancelledAtUtc))}{' '}
                  · administrador #{booking.cancellation.cancelledByUserId}
                </p>
              </details>
            )}
            {canCancel(booking, flow.now) ? (
              <button
                className="agenda-cancel"
                type="button"
                aria-label={`Cancelar reserva #${booking.id}`}
                disabled={flow.pending || flow.needsRefresh || cancelWait > 0}
                onClick={(event) => {
                  cancelTrigger.current = event.currentTarget
                  flow.open(booking)
                }}
              >
                Cancelar reserva
              </button>
            ) : (
              booking.status === 'confirmed' && (
                <p className="booking-note">
                  Atendimento iniciado ou encerrado. Cancelamento indisponível.
                </p>
              )
            )}
          </li>
        ))}
      </ul>
      {cancelWait > 0 && !flow.selected && (
        <p role="status">Aguarde {cancelWait}s antes de outro cancelamento.</p>
      )}
      {flow.data && (
        <nav className="agenda-pagination" aria-label="Páginas de reservas">
          <button
            type="button"
            disabled={blocked || flow.loading || flow.data.meta.page <= 1}
            onClick={() =>
              flow.refresh({ ...flow.query, page: flow.data!.meta.page - 1 })
            }
          >
            Página anterior
          </button>
          <span>
            Página {flow.data.meta.page} de {flow.data.meta.lastPage}
          </span>
          <button
            type="button"
            disabled={
              blocked ||
              flow.loading ||
              flow.data.meta.page >= Math.min(flow.data.meta.lastPage, 10000)
            }
            onClick={() =>
              flow.refresh({ ...flow.query, page: flow.data!.meta.page + 1 })
            }
          >
            Próxima página
          </button>
        </nav>
      )}
      {flow.selected && (
        <CancelBookingDialog
          key={flow.selected.id}
          booking={flow.selected}
          pending={flow.pending}
          eligible={canCancel(flow.selected, flow.now)}
          wait={cancelWait}
          error={flow.error}
          onClose={flow.close}
          onConfirm={flow.cancel}
          fallbackFocus={focusTarget}
          triggerFocus={cancelTrigger}
        />
      )}
    </section>
  )
}
