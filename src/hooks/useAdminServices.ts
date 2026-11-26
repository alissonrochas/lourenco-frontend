import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  ServiceOutcomeUnknownError,
  getAdminServices,
  isSessionDenied,
  saveAdminService,
  errorMessage,
} from '@/lib/api'
import type { AdminService, ServiceInput } from '@/lib/adminService'

export function useAdminServices(
  onDenied: (error: unknown) => void,
  onBusy: (busy: boolean) => void,
) {
  const [items, setItems] = useState<AdminService[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [retryAt, setRetryAt] = useState(0)
  const alive = useRef(false),
    writing = useRef(false)
  const read = useRef<AbortController | null>(null),
    write = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const handlers = useRef({ onDenied, onBusy })
  useEffect(() => {
    handlers.current = { onDenied, onBusy }
  }, [onDenied, onBusy])

  function failed(failure: unknown) {
    if (isSessionDenied(failure)) {
      setItems(null)
      handlers.current.onDenied(failure)
      return
    }
    if (failure instanceof ApiError && failure.status === 429)
      setRetryAt(Date.now() + (failure.retryAfterSeconds ?? 60) * 1000)
    setError(errorMessage(failure))
  }
  async function load() {
    read.current?.abort()
    const controller = new AbortController(),
      current = ++generation.current
    read.current = controller
    setLoading(true)
    setItems(null)
    setError(null)
    try {
      const data = await getAdminServices(controller.signal)
      if (!alive.current || controller.signal.aborted || generation.current !== current) return
      setItems(data)
      setNeedsRefresh(false)
    } catch (failure) {
      if (!alive.current || controller.signal.aborted || generation.current !== current) return
      failed(failure)
    } finally {
      if (alive.current && !controller.signal.aborted && generation.current === current)
        setLoading(false)
    }
  }
  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
      read.current?.abort()
      write.current?.abort()
    }
    // Mount-scoped resource: callbacks are read from handlers, and explicit refresh calls load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function refresh() {
    if (!writing.current && Date.now() >= retryAt) void load()
  }
  async function save(
    id: number | null,
    input: Partial<ServiceInput>,
  ): Promise<'saved' | 'review' | 'failed'> {
    if (writing.current || loading || !items || needsRefresh || Date.now() < retryAt)
      return 'failed'
    writing.current = true
    setPending(true)
    handlers.current.onBusy(true)
    setError(null)
    setNotice(null)
    read.current?.abort()
    generation.current++
    const controller = new AbortController()
    write.current = controller
    try {
      const service = await saveAdminService(id, input, controller.signal)
      if (!alive.current) return 'failed'
      setNotice(`Serviço “${service.name}” salvo. Histórico das reservas preservado.`)
      setNeedsRefresh(true)
      await load()
      return 'saved'
    } catch (failure) {
      if (!alive.current) return 'failed'
      failed(failure)
      if (
        failure instanceof ServiceOutcomeUnknownError ||
        (failure instanceof ApiError && [404, 409].includes(failure.status)) ||
        (failure instanceof ApiError && failure.status >= 500)
      ) {
        setItems(null)
        setNeedsRefresh(true)
        if (failure instanceof ApiError && failure.status >= 500)
          setError(`${failure.message} Atualize a lista antes de tentar novamente.`)
        return 'review'
      }
      return 'failed'
    } finally {
      writing.current = false
      handlers.current.onBusy(false)
      if (alive.current) setPending(false)
    }
  }
  return { items, loading, pending, needsRefresh, error, notice, retryAt, refresh, save }
}
