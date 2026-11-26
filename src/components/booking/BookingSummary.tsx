import { formatDate, formatPrice, formatTime } from '@/lib/booking'

type Props = {
  serviceName: string
  priceCents: number
  localDate: string
  startsAtMinute: number
  name?: string
  phone?: string
}
export function BookingSummary({
  serviceName,
  priceCents,
  localDate,
  startsAtMinute,
  name,
  phone,
}: Props) {
  return (
    <dl className="booking-summary">
      <div>
        <dt>Serviço</dt>
        <dd>{serviceName}</dd>
      </div>
      <div>
        <dt>Valor</dt>
        <dd>{formatPrice(priceCents)}</dd>
      </div>
      <div>
        <dt>Data</dt>
        <dd>{formatDate(localDate)}</dd>
      </div>
      <div>
        <dt>Horário</dt>
        <dd>{formatTime(startsAtMinute)}</dd>
      </div>
      <div>
        <dt>Duração do bloco</dt>
        <dd>60 minutos</dd>
      </div>
      {name && (
        <div>
          <dt>Nome</dt>
          <dd>{name}</dd>
        </div>
      )}
      {phone && (
        <div>
          <dt>Telefone</dt>
          <dd>{phone}</dd>
        </div>
      )}
    </dl>
  )
}
