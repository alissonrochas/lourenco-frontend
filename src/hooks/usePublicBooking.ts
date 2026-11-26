import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  BookingOutcomeUnknownError,
  createPublicBooking,
  errorMessage,
  getPublicAvailability,
  getPublicServices,
} from '@/lib/api'
import {
  contactError,
  isLocalDate,
  todayInSaoPaulo,
  type Availability,
  type AvailabilitySlot,
  type BookingConfirmation,
  type PublicService,
} from '@/lib/booking'

const retryAt = (error: unknown) =>
  error instanceof ApiError && error.status === 429
    ? Date.now() + (error.retryAfterSeconds ?? 60) * 1000
    : 0
export function usePublicBooking() {
  const [step, setStep] = useState(0)
  const [services, setServices] = useState<PublicService[]>([])
  const [service, setService] = useState<PublicService | null>(null)
  const [servicesLoading, setServicesLoading] = useState(true)
  const [servicesError, setServicesError] = useState<string | null>(null)
  const [servicesRetryAt, setServicesRetryAt] = useState(0)
  const [date, setDate] = useState('')
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsRetryAt, setSlotsRetryAt] = useState(0)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [postRetryAt, setPostRetryAt] = useState(0)
  const [uncertain, setUncertain] = useState(false)
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(
    null,
  )
  const alive = useRef(false)
  const submitting = useRef(false)
  const slotsRequest = useRef<AbortController | null>(null)
  const serviceRequest = useRef<AbortController | null>(null)
  const postRequest = useRef<AbortController | null>(null)
  const generation = useRef(0)

  async function loadServices() {
    if (Date.now() < servicesRetryAt) return
    serviceRequest.current?.abort()
    const controller = new AbortController()
    serviceRequest.current = controller
    setServicesLoading(true)
    setServicesError(null)
    try {
      const result = await getPublicServices(controller.signal)
      if (!alive.current || controller.signal.aborted) return
      setServices(result)
      setService((current) =>
        current
          ? (result.find((item) => item.id === current.id) ?? null)
          : null,
      )
    } catch (failure) {
      if (!alive.current || controller.signal.aborted) return
      setServicesError(errorMessage(failure))
      setServicesRetryAt(retryAt(failure))
    } finally {
      if (alive.current && !controller.signal.aborted) setServicesLoading(false)
    }
  }
  function abortRequests() {
    serviceRequest.current?.abort()
    slotsRequest.current?.abort()
    postRequest.current?.abort()
  }
  useEffect(() => {
    alive.current = true
    void loadServices()
    return () => {
      alive.current = false
      abortRequests()
    }
    // Initial catalogue only; explicit retries have their own deadline guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function invalidateSlot() {
    generation.current++
    slotsRequest.current?.abort()
    setSlot(null)
    setAvailability(null)
    setSlotsLoading(false)
  }
  function chooseService(value: PublicService) {
    invalidateSlot()
    setService(value)
    setError(null)
  }
  function chooseDate(value: string) {
    invalidateSlot()
    setDate(value)
    setError(null)
  }
  async function loadSlots() {
    if (Date.now() < slotsRetryAt) return
    if (!isLocalDate(date) || date < todayInSaoPaulo()) {
      setError('Escolha uma data válida, a partir de hoje na barbearia.')
      return
    }
    if (!service) {
      setStep(0)
      return
    }
    invalidateSlot()
    const id = generation.current
    const controller = new AbortController()
    slotsRequest.current = controller
    setStep(2)
    setSlotsLoading(true)
    setError(null)
    try {
      const result = await getPublicAvailability(date, controller.signal)
      if (
        alive.current &&
        !controller.signal.aborted &&
        id === generation.current
      )
        setAvailability(result)
    } catch (failure) {
      if (
        alive.current &&
        !controller.signal.aborted &&
        id === generation.current
      ) {
        setError(errorMessage(failure))
        setSlotsRetryAt(retryAt(failure))
      }
    } finally {
      if (alive.current && id === generation.current) setSlotsLoading(false)
    }
  }
  function next() {
    setError(null)
    if (step === 0 && service) setStep(1)
    else if (step === 1) void loadSlots()
    else if (step === 2 && slot) setStep(3)
    else if (step === 3) {
      const message = contactError(name, phone)
      if (message) setError(message)
      else setStep(4)
    }
  }
  function back(target = step - 1) {
    if (submitting.current || uncertain) return
    setError(null)
    setStep(Math.max(0, target))
  }
  async function confirm() {
    if (
      submitting.current ||
      uncertain ||
      confirmation ||
      Date.now() < postRetryAt ||
      !service ||
      !slot
    )
      return
    const invalid = contactError(name, phone)
    if (invalid) {
      setStep(3)
      setError(invalid)
      return
    }
    if (!isLocalDate(date) || date < todayInSaoPaulo()) {
      invalidateSlot()
      setStep(1)
      setError('Escolha uma data válida, a partir de hoje na barbearia.')
      return
    }
    submitting.current = true
    setPending(true)
    setError(null)
    const controller = new AbortController()
    postRequest.current = controller
    try {
      const result = await createPublicBooking(
        {
          serviceId: service.id,
          localDate: date,
          startsAtMinute: slot.startsAtMinute,
          name: name.trim(),
          phone: phone.trim(),
        },
        controller.signal,
      )
      if (alive.current) {
        setConfirmation(result)
        setName('')
        setPhone('')
      }
    } catch (failure) {
      if (!alive.current) return
      if (
        failure instanceof BookingOutcomeUnknownError ||
        (failure instanceof ApiError &&
          failure.status >= 500 &&
          failure.status !== 503)
      ) {
        setUncertain(true)
        setError(new BookingOutcomeUnknownError().message)
      } else if (failure instanceof ApiError && failure.status === 409) {
        invalidateSlot()
        setStep(2)
        setError(
          'Este horário acabou de ficar indisponível. Atualize os horários e escolha outro. Seus dados foram mantidos.',
        )
      } else if (failure instanceof ApiError && failure.status === 422) {
        invalidateSlot()
        setStep(0)
        setError(
          'Dados inválidos ou serviço indisponível. Atualize os serviços e revise sua seleção e seus dados.',
        )
      } else {
        setPostRetryAt(retryAt(failure))
        setError(
          failure instanceof ApiError && failure.status === 503
            ? 'A confirmação está temporariamente indisponível. Tente novamente mais tarde.'
            : errorMessage(failure),
        )
      }
    } finally {
      submitting.current = false
      if (alive.current) setPending(false)
    }
  }
  return {
    step,
    services,
    service,
    servicesLoading,
    servicesError,
    servicesRetryAt,
    date,
    availability,
    slot,
    slotsLoading,
    slotsRetryAt,
    name,
    phone,
    error,
    pending,
    postRetryAt,
    uncertain,
    confirmation,
    loadServices,
    chooseService,
    chooseDate,
    loadSlots,
    setSlot,
    setName,
    setPhone,
    next,
    back,
    confirm,
  }
}
