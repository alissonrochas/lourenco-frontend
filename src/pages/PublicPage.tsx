import { useEffect, useRef, type FormEvent } from 'react'
import { FormField } from '@/components/FormField'
import { Feedback } from '@/components/Feedback'
import { BookingSummary } from '@/components/booking/BookingSummary'
import { usePublicBooking } from '@/hooks/usePublicBooking'
import { useRetryCountdown } from '@/hooks/useRetryCountdown'
import {
  formatDate,
  formatPrice,
  formatTime,
  todayInSaoPaulo,
} from '@/lib/booking'

const steps = ['Serviço', 'Data', 'Horário', 'Seus dados', 'Revisão']
export function PublicPage() {
  const flow = usePublicBooking()
  const servicesWait = useRetryCountdown(flow.servicesRetryAt)
  const slotsWait = useRetryCountdown(flow.slotsRetryAt)
  const postWait = useRetryCountdown(flow.postRetryAt)
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    title.current?.focus()
  }, [flow.step, flow.confirmation, flow.uncertain])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (flow.step === 4) void flow.confirm()
    else flow.next()
  }

  if (flow.confirmation) {
    const result = flow.confirmation
    return (
      <div className="public-booking booking-result">
        <p className="booking-eyebrow">Tudo certo por aqui</p>
        <h2 ref={title} tabIndex={-1}>
          Agendamento confirmado
        </h2>
        <p role="status">
          Sua reserva é a <strong>#{result.id}</strong>. Guarde esse número.
        </p>
        <BookingSummary
          serviceName={result.serviceName}
          priceCents={result.priceCents}
          localDate={result.localDate}
          startsAtMinute={result.startsAtMinute}
        />
        <p>
          Das {result.startsAtLocal.slice(11, 16)} às{' '}
          {result.endsAtLocal.slice(11, 16)} · horário de São Paulo.
        </p>
        <p className="booking-note">
          Será um prazer receber você na Lourenço Barbearia.
        </p>
      </div>
    )
  }
  if (flow.uncertain)
    return (
      <div className="public-booking booking-result">
        <p className="booking-eyebrow">Precisamos verificar</p>
        <h2 ref={title} tabIndex={-1}>
          Confirmação não recebida
        </h2>
        <Feedback message={flow.error} error />
        <p>
          Fale com a barbearia pelo canal que você já utiliza. Informe a data e
          o horário escolhidos antes de tentar uma nova reserva.
        </p>
      </div>
    )

  return (
    <div className="public-booking">
      <header className="booking-heading">
        <p className="booking-eyebrow">Seu tempo, bem cuidado</p>
        <h2 ref={title} tabIndex={-1}>
          Agende seu horário
        </h2>
        <p>Escolha seu cuidado. Nós preparamos o resto.</p>
      </header>
      <ol className="booking-progress" aria-label="Etapas do agendamento">
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={flow.step === index ? 'step' : undefined}
          >
            <button
              type="button"
              disabled={index >= flow.step || flow.pending}
              onClick={() => flow.back(index)}
              aria-label={`${label}${index < flow.step ? ', etapa concluída, voltar' : ''}`}
            >
              <span aria-hidden="true">
                {index < flow.step ? '✓' : index + 1}
              </span>
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ol>
      <form
        aria-label="Agendamento público"
        onSubmit={submit}
        aria-busy={flow.pending}
      >
        <fieldset disabled={flow.pending} className="booking-stage">
          <legend>
            {flow.step + 1}. {steps[flow.step]}
          </legend>
          {flow.step === 0 && (
            <>
              {flow.servicesLoading && (
                <p role="status">Carregando serviços…</p>
              )}
              <Feedback message={flow.servicesError} error />
              {!flow.servicesLoading &&
                !flow.servicesError &&
                flow.services.length === 0 && (
                  <p role="status">
                    Nenhum serviço disponível no momento. Tente novamente mais
                    tarde.
                  </p>
                )}
              <div
                className="service-options"
                role="radiogroup"
                aria-label="Serviço desejado"
              >
                {flow.services.map((service) => (
                  <label className="service-option" key={service.id}>
                    <input
                      type="radio"
                      name="service"
                      checked={flow.service?.id === service.id}
                      onChange={() => flow.chooseService(service)}
                    />
                    <span className="service-copy">
                      <strong>{service.name}</strong>
                      {service.description && (
                        <span>{service.description}</span>
                      )}
                    </span>
                    <strong className="service-price">
                      {formatPrice(service.priceCents)}
                    </strong>
                  </label>
                ))}
              </div>
              {!flow.servicesLoading && (
                <button
                  className="booking-text-button"
                  type="button"
                  disabled={servicesWait > 0}
                  onClick={() => void flow.loadServices()}
                >
                  {servicesWait
                    ? `Aguarde ${servicesWait}s para atualizar serviços`
                    : 'Atualizar serviços'}
                </button>
              )}
            </>
          )}
          {flow.step === 1 && (
            <>
              <p>Em qual dia podemos receber você?</p>
              <FormField
                id="booking-date"
                label="Data do atendimento"
                type="date"
                min={todayInSaoPaulo()}
                max="9999-12-31"
                value={flow.date}
                onChange={(event) => flow.chooseDate(event.target.value)}
                required
                aria-describedby="booking-timezone"
              />
              <p id="booking-timezone" className="booking-note">
                Datas e horários da barbearia em America/Sao_Paulo.
              </p>
            </>
          )}
          {flow.step === 2 && (
            <>
              <p>Horários em {formatDate(flow.date)} · São Paulo</p>
              {flow.slotsLoading && <p role="status">Consultando horários…</p>}
              {flow.availability?.slots.length === 0 && (
                <p role="status">
                  Não há horários disponíveis nesta data. Escolha outro dia.
                </p>
              )}
              <div
                className="slot-options"
                role="radiogroup"
                aria-label="Horário disponível"
              >
                {flow.availability?.slots.map((slot) => (
                  <label className="slot-option" key={slot.startsAtMinute}>
                    <input
                      type="radio"
                      name="slot"
                      checked={
                        flow.slot?.startsAtMinute === slot.startsAtMinute
                      }
                      onChange={() => flow.setSlot(slot)}
                    />
                    <span>{formatTime(slot.startsAtMinute)}</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="booking-text-button"
                disabled={flow.slotsLoading || slotsWait > 0}
                onClick={() => void flow.loadSlots()}
              >
                {slotsWait
                  ? `Aguarde ${slotsWait}s para atualizar horários`
                  : 'Atualizar horários'}
              </button>
              <p className="booking-note">
                O horário é reservado somente após a confirmação.
              </p>
            </>
          )}
          {flow.step === 3 && (
            <>
              <p>
                Como podemos identificar seu atendimento? Você não precisa criar
                uma conta.
              </p>
              <FormField
                id="booking-name"
                label="Nome completo"
                value={flow.name}
                onChange={(event) => flow.setName(event.target.value)}
                autoComplete="name"
                minLength={2}
                maxLength={120}
                required
              />
              <FormField
                id="booking-phone"
                label="Telefone"
                type="tel"
                inputMode="tel"
                value={flow.phone}
                onChange={(event) => flow.setPhone(event.target.value)}
                autoComplete="tel"
                maxLength={30}
                required
              />
              <p className="booking-note">
                Seus dados são usados para identificar a reserva.
              </p>
            </>
          )}
          {flow.step === 4 && flow.service && flow.slot && (
            <>
              <p>Confira os detalhes antes de reservar.</p>
              <BookingSummary
                serviceName={flow.service.name}
                priceCents={flow.service.priceCents}
                localDate={flow.date}
                startsAtMinute={flow.slot.startsAtMinute}
                name={flow.name.trim()}
                phone={flow.phone.trim()}
              />
              <p className="booking-note">
                Horário de São Paulo. Aguarde a resposta após confirmar. Se a
                conexão cair, fale com a barbearia antes de enviar novamente.
              </p>
            </>
          )}
        </fieldset>
        <Feedback message={flow.error} error />
        <div className="booking-actions">
          {flow.step > 0 && (
            <button
              type="button"
              className="booking-secondary"
              disabled={flow.pending}
              onClick={() => flow.back()}
            >
              Voltar
            </button>
          )}
          <button
            className="booking-primary"
            type="submit"
            disabled={
              flow.pending ||
              (postWait > 0 && flow.step === 4) ||
              (flow.step === 0 && (!flow.service || flow.servicesLoading)) ||
              (flow.step === 2 && (!flow.slot || flow.slotsLoading)) ||
              (flow.step === 1 && slotsWait > 0)
            }
          >
            {flow.pending
              ? 'Confirmando…'
              : flow.step === 4
                ? postWait
                  ? `Aguarde ${postWait}s para confirmar`
                  : 'Confirmar agendamento'
                : flow.step === 3
                  ? 'Revisar agendamento'
                  : 'Continuar'}
          </button>
        </div>
      </form>
    </div>
  )
}
