import { useRef, useState } from 'react'
import { Feedback } from '@/components/Feedback'
import { useAdminServices } from '@/hooks/useAdminServices'
import { useRetryCountdown } from '@/hooks/useRetryCountdown'
import { formatServicePrice } from '@/lib/adminService'
import type { AdminService, ServiceInput } from '@/lib/adminService'
import { ServiceEditor } from './ServiceEditor'
import { ServiceChangeDialog } from './ServiceChangeDialog'

export function ServicesDashboard({
  onDenied,
  onBusy,
}: {
  onDenied: (error: unknown) => void
  onBusy: (busy: boolean) => void
}) {
  const flow = useAdminServices(onDenied, onBusy)
  const [editor, setEditor] = useState<{ service: AdminService | null } | null>(null)
  const [review, setReview] = useState<{
    id: number | null
    name: string
    input: Partial<ServiceInput>
  } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null),
    formArea = useRef<HTMLDivElement>(null),
    triggerFocus = useRef<HTMLElement | null>(null)
  const wait = useRetryCountdown(flow.retryAt)
  const blocked = flow.pending || flow.loading || flow.needsRefresh || !flow.items || wait > 0
  function open(service: AdminService | null) {
    setEditor({ service })
    setTimeout(() => formArea.current?.querySelector('input')?.focus(), 0)
  }
  function closeEditor() {
    setEditor(null)
    heading.current?.focus()
  }
  async function confirm() {
    if (!review) return
    const result = await flow.save(review.id, review.input)
    if (result === 'saved' || result === 'review') {
      setReview(null)
      setEditor(null)
    }
  }
  return (
    <section className="admin-dashboard" aria-labelledby="services-title">
      <header className="admin-agenda-heading">
        <div>
          <p className="booking-eyebrow">Catálogo da barbearia</p>
          <h3 id="services-title" ref={heading} tabIndex={-1}>
            Serviços
          </h3>
          <p className="booking-note">
            Gerencie a oferta. O histórico das reservas permanece intacto.
          </p>
        </div>
        <button
          type="button"
          className="booking-secondary"
          disabled={flow.pending || wait > 0}
          onClick={() => {
            setEditor(null)
            setReview(null)
            flow.refresh()
          }}
        >
          {wait ? `Aguarde ${wait}s para atualizar serviços` : 'Atualizar serviços'}
        </button>
      </header>
      <Feedback message={flow.notice} />
      {!review && <Feedback message={flow.error} error />}
      {flow.needsRefresh && (
        <p role="status">
          Confira o estado atual no servidor: atualize a lista antes de outra operação. Nenhuma
          escrita será reenviada automaticamente.
        </p>
      )}
      {flow.loading && <p role="status">Carregando serviços…</p>}
      <button
        type="button"
        className="booking-primary"
        disabled={blocked || !!editor}
        onClick={() => open(null)}
      >
        Novo serviço
      </button>
      <div ref={formArea}>
        {editor && (
          <ServiceEditor
            key={editor.service?.id ?? 'new'}
            service={editor.service}
            disabled={blocked || !!review}
            onClose={closeEditor}
            onReview={(input) => {
              triggerFocus.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null
              setReview({
                id: editor.service?.id ?? null,
                name: input.name ?? editor.service?.name ?? '',
                input,
              })
            }}
          />
        )}
      </div>
      {flow.items?.length === 0 && <p role="status">Nenhum serviço cadastrado.</p>}
      <ul className="agenda-list" aria-label="Serviços cadastrados" aria-busy={flow.loading}>
        {flow.items?.map((service) => (
          <li key={service.id} className="agenda-card service-card">
            <div className="agenda-card-heading">
              <h4>{service.name}</h4>
              <span className={`agenda-status ${service.isActive ? 'confirmed' : 'cancelled'}`}>
                {service.isActive ? 'Ativo' : 'Inativo'}
              </span>
            </div>
            {service.description && <p className="service-description">{service.description}</p>}
            <dl className="agenda-details">
              <div>
                <dt>Preço</dt>
                <dd>{formatServicePrice(service.priceCents)}</dd>
              </div>
              <div>
                <dt>Duração</dt>
                <dd>{service.durationMinutes} minutos</dd>
              </div>
            </dl>
            <div className="service-actions">
              <button
                type="button"
                className="booking-secondary"
                aria-label={`Editar serviço ${service.name}`}
                disabled={blocked || !!editor}
                onClick={() => open(service)}
              >
                Editar
              </button>
              <button
                type="button"
                className={service.isActive ? 'agenda-cancel' : 'booking-secondary'}
                aria-label={`${service.isActive ? 'Desativar' : 'Ativar'} serviço ${service.name}`}
                disabled={blocked || !!editor}
                onClick={(event) => {
                  triggerFocus.current = event.currentTarget
                  setReview({
                    id: service.id,
                    name: service.name,
                    input: { isActive: !service.isActive },
                  })
                }}
              >
                {service.isActive ? 'Desativar' : 'Ativar'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {review && (
        <ServiceChangeDialog
          input={review.input}
          name={review.name}
          creating={review.id === null}
          pending={flow.pending}
          wait={wait}
          error={flow.error}
          onClose={() => setReview(null)}
          onConfirm={() => void confirm()}
          fallback={heading}
          triggerFocus={triggerFocus}
        />
      )}
    </section>
  )
}
