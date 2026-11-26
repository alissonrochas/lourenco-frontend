import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  CancellationOutcomeUnknownError,
  cancelAdminBooking,
  getAdminBookings,
  isSessionDenied,
} from '@/lib/api'
import { todayInSaoPaulo } from '@/lib/booking'
import {
  canCancel,
  type AdminBooking,
  type AdminBookingList,
  type BookingFilters,
} from '@/lib/adminBooking'
const deadline = (failure: unknown) =>
  failure instanceof ApiError && failure.status === 429
    ? Date.now() + (failure.retryAfterSeconds ?? 60) * 1000
    : 0
export function useAdminBookings(onDenied: (error: unknown) => void) {
  const [query, setQuery] = useState<BookingFilters>(() => ({
    from: todayInSaoPaulo(),
    to: todayInSaoPaulo(),
    page: 1,
    perPage: 50,
  }))
  const [data, setData] = useState<AdminBookingList | null>(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [listRetryAt, setListRetryAt] = useState(0)
  const [cancelRetryAt, setCancelRetryAt] = useState(0)
  const [selected, setSelected] = useState<AdminBooking | null>(null)
  const [pending, setPending] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [now, setNow] = useState(Date.now)
  const alive = useRef(false)
  const writing = useRef(false)
  const post = useRef<AbortController | null>(null)
  useEffect(() => {
    alive.current = true
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const currentPost = post
    return () => {
      alive.current = false
      clearInterval(tick)
      currentPost.current?.abort()
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    getAdminBookings(query, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setLoading(false)
        setNeedsRefresh(false)
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setData(null)
        setLoading(false)
        if (isSessionDenied(failure)) {
          onDenied(failure)
          return
        }
        setListRetryAt(deadline(failure))
        setError(
          failure instanceof ApiError
            ? failure.message
            : 'Não foi possível carregar as reservas. Atualize a consulta.',
        )
      })
    return () => controller.abort()
  }, [query, revision, onDenied])
  function refresh(next = query) {
    if (writing.current || Date.now() < listRetryAt) return
    setData(null)
    setLoading(true)
    setSelected(null)
    setError(null)
    setQuery(next)
    setRevision((value) => value + 1)
  }
  function open(booking: AdminBooking) {
    if (
      writing.current ||
      needsRefresh ||
      loading ||
      Date.now() < cancelRetryAt ||
      !canCancel(booking, Date.now())
    )
      return
    setError(null)
    setNotice(null)
    setSelected(booking)
  }
  function close() {
    if (!writing.current) setSelected(null)
  }
  async function cancel(reason: string) {
    if (
      writing.current ||
      !selected ||
      needsRefresh ||
      Date.now() < cancelRetryAt
    )
      return
    if (!reason.trim() || reason.trim().length > 500) {
      setError('Informe um motivo com 1 a 500 caracteres.')
      return
    }
    if (!canCancel(selected, Date.now())) {
      setError('Esta reserva já começou. Atualize a lista.')
      setSelected(null)
      setNeedsRefresh(true)
      return
    }
    writing.current = true
    setPending(true)
    setError(null)
    setNotice(null)
    const controller = new AbortController()
    post.current = controller
    try {
      const booking = await cancelAdminBooking(
        selected.id,
        reason,
        controller.signal,
      )
      if (!alive.current) return
      setSelected(null)
      setNotice(`Reserva #${booking.id} cancelada. Histórico preservado.`)
      setData(null)
      setLoading(true)
      setRevision((value) => value + 1)
    } catch (failure) {
      if (!alive.current) return
      if (isSessionDenied(failure)) {
        setData(null)
        setSelected(null)
        onDenied(failure)
        return
      }
      setCancelRetryAt(deadline(failure))
      if (
        failure instanceof CancellationOutcomeUnknownError ||
        (failure instanceof ApiError && failure.status >= 500)
      ) {
        setError(
          failure instanceof ApiError && failure.status === 503
            ? 'Gestão de reservas temporariamente indisponível. Atualize a lista antes de tentar novamente.'
            : new CancellationOutcomeUnknownError().message,
        )
        setNeedsRefresh(true)
        setSelected(null)
        setData(null)
      } else if (
        failure instanceof ApiError &&
        [404, 409].includes(failure.status)
      ) {
        setError(
          failure.status === 404
            ? 'Reserva não encontrada. Atualize a lista.'
            : 'O cancelamento não foi permitido. Atualize a lista para conferir o estado atual.',
        )
        setNeedsRefresh(true)
        setSelected(null)
      } else
        setError(
          failure instanceof ApiError
            ? failure.message
            : 'Não foi possível preparar o cancelamento. Tente novamente.',
        )
    } finally {
      writing.current = false
      if (alive.current) setPending(false)
    }
  }
  return {
    query,
    data,
    loading,
    error,
    notice,
    listRetryAt,
    cancelRetryAt,
    selected,
    pending,
    needsRefresh,
    now,
    refresh,
    open,
    close,
    cancel,
  }
}
