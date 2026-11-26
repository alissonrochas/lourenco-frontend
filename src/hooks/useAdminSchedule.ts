import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  ScheduleOutcomeUnknownError,
  errorMessage,
  getWeeklySchedule,
  getDateExceptions,
  isSessionDenied,
  saveSchedule,
} from '@/lib/api'
import { isLocalDate, todayInSaoPaulo } from '@/lib/booking'
import type { DayPatch, ExceptionInput } from '@/lib/adminSchedule'
type Data = {
  weekly: Awaited<ReturnType<typeof getWeeklySchedule>>
  dates: Awaited<ReturnType<typeof getDateExceptions>>
}
export function useAdminSchedule(
  onDenied: (failure: unknown) => void,
  onBusy: (busy: boolean) => void,
) {
  const [date, setDate] = useState(todayInSaoPaulo),
    [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [needsRefresh, setNeedsRefresh] = useState(false)
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [retryAt, setRetryAt] = useState(0)
  const alive = useRef(false),
    writing = useRef(false),
    revision = useRef(0)
  const read = useRef<AbortController | null>(null),
    write = useRef<AbortController | null>(null)
  const callbacks = useRef({ onDenied, onBusy })
  useEffect(() => {
    callbacks.current = { onDenied, onBusy }
  }, [onDenied, onBusy])
  function failed(failure: unknown) {
    if (isSessionDenied(failure)) {
      setData(null)
      callbacks.current.onDenied(failure)
      return
    }
    if (failure instanceof ApiError && failure.status === 429)
      setRetryAt(Date.now() + (failure.retryAfterSeconds ?? 60) * 1000)
    setError(errorMessage(failure))
  }
  async function load(next: string) {
    if (!isLocalDate(next)) {
      setError('Informe uma data local válida.')
      return
    }
    read.current?.abort()
    const controller = new AbortController(),
      generation = ++revision.current
    read.current = controller
    setLoading(true)
    setData(null)
    setError(null)
    setDate(next)
    try {
      const [weekly, dates] = await Promise.all([
        getWeeklySchedule(controller.signal),
        getDateExceptions(next, controller.signal),
      ])
      if (!alive.current || controller.signal.aborted || generation !== revision.current) return
      setData({ weekly, dates })
      setNeedsRefresh(false)
    } catch (failure) {
      if (alive.current && !controller.signal.aborted && generation === revision.current)
        failed(failure)
    } finally {
      if (alive.current && !controller.signal.aborted && generation === revision.current)
        setLoading(false)
    }
  }
  useEffect(() => {
    alive.current = true
    void load(todayInSaoPaulo())
    return () => {
      alive.current = false
      read.current?.abort()
      write.current?.abort()
    }
    // Mount-scoped resource; callbacks remain current through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function refresh(next = date) {
    if (!writing.current && Date.now() >= retryAt) void load(next)
  }
  async function save(kind: 'weekly' | 'date', input: DayPatch | ExceptionInput): Promise<boolean> {
    if (writing.current || loading || !data || needsRefresh || Date.now() < retryAt) return false
    writing.current = true
    setPending(true)
    callbacks.current.onBusy(true)
    setError(null)
    setNotice(null)
    read.current?.abort()
    revision.current++
    const controller = new AbortController()
    write.current = controller
    try {
      await saveSchedule(
        kind,
        input,
        kind === 'weekly' ? data.weekly.tag : data.dates.tag,
        controller.signal,
      )
      if (!alive.current) return false
      setNotice(
        'Calendário salvo. Reservas existentes preservadas. Consulte novamente a disponibilidade pública para ver a oferta atual.',
      )
      setNeedsRefresh(true)
      await load(date)
      return true
    } catch (failure) {
      if (!alive.current) return false
      failed(failure)
      if (
        failure instanceof ScheduleOutcomeUnknownError ||
        (failure instanceof ApiError &&
          ([404, 409].includes(failure.status) || failure.status >= 500))
      ) {
        setNeedsRefresh(true)
        setData(null)
        if (failure instanceof ApiError)
          setError(`${failure.message} Recarregue antes de outra operação.`)
        return true
      }
      return false
    } finally {
      writing.current = false
      callbacks.current.onBusy(false)
      if (alive.current) setPending(false)
    }
  }
  return { date, data, loading, pending, needsRefresh, error, notice, retryAt, refresh, save }
}
