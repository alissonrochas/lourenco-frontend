import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  BookingDateOutOfRangeError,
  PublicBookingNotAcceptedError,
  BOOKING_REFUSED_MESSAGE,
  BookingOutcomeUnknownError,
  createPublicBooking,
  errorMessage,
  getPublicAvailability,
  getPublicServices,
} from '@/lib/api'
import {
  contactError,
  dateWithinPolicy,
  isLocalDate,
  todayInSaoPaulo,
  type BookingPolicy,
  type Availability,
  type AvailabilitySlot,
  type BookingConfirmation,
  type PublicService,
} from '@/lib/booking'

const DATE_CHANGED =
  'A data escolhida não está mais disponível para agendamento. Escolha outra data. Seus dados foram mantidos.'
const INVALID_DATE =
  'Escolha uma data válida dentro do período informado pela barbearia.'
const SLOT_CHANGED =
  'Este horário acabou de ficar indisponível. Atualize os horários e escolha outro. Seus dados foram mantidos.'
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
  const [policy, setPolicy] = useState<BookingPolicy | null>(null)
  const [policyLoading, setPolicyLoading] = useState(false)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [policyRejected, setPolicyRejected] = useState(false)
  const [date, setDate] = useState('')
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsRetryAt, setSlotsRetryAt] = useState(0)
  const [name, setNameValue] = useState('')
  const [phone, setPhoneValue] = useState('')
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
  const currentPolicy = useRef<BookingPolicy | null>(null)
  const currentDate = useRef('')
  const observedDay = useRef('')
  const policySequence = useRef(0)
  const appliedPolicy = useRef(0)
  const policyRequest = useRef<{
    controller: AbortController
    promise: Promise<BookingPolicy | null>
  } | null>(null)
  const resume = useRef<() => void>(() => {})

  function acceptPolicy(
    value: BookingPolicy,
    ticket: number,
    clientDay: string,
  ) {
    // A late read must not replace newer limits, even when fetch ignores abort.
    if (ticket < appliedPolicy.current) return
    appliedPolicy.current = ticket
    currentPolicy.current = value
    observedDay.current = clientDay
    setPolicy(value)
    setPolicyError(null)
  }
  function invalidateSlot() {
    generation.current++
    slotsRequest.current?.abort()
    setSlot(null)
    setAvailability(null)
    setSlotsLoading(false)
  }
  function recoverDate(
    failure: BookingDateOutOfRangeError,
    ticket: number,
    clientDay: string,
  ) {
    acceptPolicy(failure.policy, ticket, clientDay)
    invalidateSlot()
    setStep(1)
    setError(DATE_CHANGED)
  }
  async function refreshPolicy(): Promise<BookingPolicy | null> {
    if (policyRequest.current) return policyRequest.current.promise
    if (Date.now() < slotsRetryAt) return null
    const controller = new AbortController()
    const ticket = ++policySequence.current
    const clientDay = todayInSaoPaulo()
    // The device date is only a probe. A validated 422 also supplies authoritative limits.
    const probe = currentPolicy.current?.minDate ?? clientDay
    setPolicyLoading(true)
    setPolicyError(null)
    const promise = (async () => {
      try {
        let value: BookingPolicy
        try {
          value = (await getPublicAvailability(probe, controller.signal)).policy
        } catch (failure) {
          if (!(failure instanceof BookingDateOutOfRangeError)) throw failure
          value = failure.policy
        }
        if (!alive.current || controller.signal.aborted) return null
        acceptPolicy(value, ticket, clientDay)
        const latest = currentPolicy.current!
        if (
          currentDate.current &&
          !dateWithinPolicy(currentDate.current, latest)
        ) {
          invalidateSlot()
          setStep(1)
          setError(DATE_CHANGED)
        }
        return latest
      } catch (failure) {
        if (!alive.current || controller.signal.aborted) return null
        if (ticket < appliedPolicy.current) return currentPolicy.current
        setPolicyError(errorMessage(failure))
        setSlotsRetryAt(retryAt(failure))
        return null
      } finally {
        if (policyRequest.current?.controller === controller) {
          policyRequest.current = null
          if (alive.current) setPolicyLoading(false)
        }
      }
    })()
    policyRequest.current = { controller, promise }
    return promise
  }
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
  useEffect(() => {
    alive.current = true
    void loadServices()
    const onResume = () => resume.current()
    const onVisible = () => {
      if (document.visibilityState === 'visible') onResume()
    }
    // Local checks only; the server is consulted on day change, not polled each minute.
    const timer = setInterval(onResume, 60_000)
    window.addEventListener('focus', onResume)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      serviceRequest.current?.abort()
      slotsRequest.current?.abort()
      postRequest.current?.abort()
      policyRequest.current?.controller.abort()
      policyRequest.current = null
      clearInterval(timer)
      window.removeEventListener('focus', onResume)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // Initial catalogue and lifecycle listeners only; callbacks read current refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  resume.current = () => {
    if (
      step < 1 ||
      confirmation ||
      uncertain ||
      submitting.current ||
      !currentPolicy.current
    )
      return
    if (observedDay.current !== todayInSaoPaulo()) void refreshPolicy()
  }

  function clearRefusal() {
    setPolicyRejected(false)
    setError(null)
  }
  function setName(value: string) {
    setNameValue(value)
    clearRefusal()
  }
  function setPhone(value: string) {
    setPhoneValue(value)
    clearRefusal()
  }
  function chooseService(value: PublicService) {
    invalidateSlot()
    setService(value)
    clearRefusal()
  }
  function chooseDate(value: string) {
    invalidateSlot()
    currentDate.current = value
    setDate(value)
    clearRefusal()
  }
  async function loadSlots() {
    if (Date.now() < slotsRetryAt) return
    if (!service) {
      setStep(0)
      return
    }
    if (!isLocalDate(date)) {
      setStep(1)
      setError(INVALID_DATE)
      return
    }
    invalidateSlot()
    const id = generation.current
    setSlotsLoading(true)
    setError(null)
    try {
      const limits =
        !currentPolicy.current ||
        policyError ||
        observedDay.current !== todayInSaoPaulo()
          ? await refreshPolicy()
          : currentPolicy.current
      if (!alive.current || id !== generation.current) return
      if (!limits) {
        setStep(1)
        return
      }
      if (!dateWithinPolicy(date, limits)) {
        setStep(1)
        setError(INVALID_DATE)
        return
      }
      const controller = new AbortController()
      slotsRequest.current = controller
      const ticket = ++policySequence.current,
        clientDay = todayInSaoPaulo()
      setStep(2)
      try {
        const result = await getPublicAvailability(date, controller.signal)
        if (
          !alive.current ||
          controller.signal.aborted ||
          id !== generation.current
        )
          return
        acceptPolicy(result.policy, ticket, clientDay)
        setAvailability(result)
      } catch (failure) {
        if (
          !alive.current ||
          controller.signal.aborted ||
          id !== generation.current
        )
          return
        if (failure instanceof BookingDateOutOfRangeError)
          recoverDate(failure, ticket, clientDay)
        else {
          setError(errorMessage(failure))
          setSlotsRetryAt(retryAt(failure))
        }
      }
    } finally {
      if (alive.current && id === generation.current) setSlotsLoading(false)
    }
  }
  function next() {
    setError(policyRejected ? BOOKING_REFUSED_MESSAGE : null)
    if (step === 0 && service) {
      setStep(1)
      if (
        !currentPolicy.current ||
        observedDay.current !== todayInSaoPaulo() ||
        policyError
      )
        void refreshPolicy()
    } else if (step === 1) void loadSlots()
    else if (step === 2 && slot) setStep(3)
    else if (step === 3) {
      const message = contactError(name, phone)
      if (message) setError(message)
      else setStep(4)
    }
  }
  function back(target = step - 1) {
    if (submitting.current || uncertain) return
    if (!policyRejected) setError(null)
    if (target <= 1) invalidateSlot()
    setStep(Math.max(0, target))
  }
  async function confirm() {
    if (
      submitting.current ||
      uncertain ||
      confirmation ||
      policyRejected ||
      Date.now() < postRetryAt ||
      Date.now() < slotsRetryAt ||
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
    if (
      !currentPolicy.current ||
      !dateWithinPolicy(date, currentPolicy.current)
    ) {
      invalidateSlot()
      setStep(1)
      setError(INVALID_DATE)
      return
    }
    submitting.current = true
    setPending(true)
    setError(null)
    const controller = new AbortController()
    postRequest.current = controller
    const ticket = ++policySequence.current,
      clientDay = todayInSaoPaulo()
    let attemptedWrite = false
    const readTimeout = setTimeout(() => controller.abort(), 20_000)
    try {
      // Fresh server read before every POST: handles real midnight/config changes even
      // when the device clock is wrong. It never resends or retries a write.
      const fresh = await getPublicAvailability(date, controller.signal)
      clearTimeout(readTimeout)
      if (!alive.current) return
      controller.signal.throwIfAborted()
      acceptPolicy(fresh.policy, ticket, clientDay)
      if (
        !fresh.slots.some((item) => item.startsAtMinute === slot.startsAtMinute)
      ) {
        invalidateSlot()
        setStep(2)
        setError(SLOT_CHANGED)
        return
      }
      attemptedWrite = true
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
        setNameValue('')
        setPhoneValue('')
      }
    } catch (failure) {
      if (!alive.current) return
      if (failure instanceof BookingDateOutOfRangeError)
        recoverDate(failure, ticket, clientDay)
      else if (failure instanceof PublicBookingNotAcceptedError) {
        setPolicyRejected(true)
        setError(BOOKING_REFUSED_MESSAGE)
      } else if (
        failure instanceof BookingOutcomeUnknownError ||
        (attemptedWrite &&
          failure instanceof ApiError &&
          failure.status >= 500 &&
          failure.status !== 503)
      ) {
        setUncertain(true)
        setError(new BookingOutcomeUnknownError().message)
      } else if (failure instanceof ApiError && failure.status === 409) {
        invalidateSlot()
        setStep(2)
        setError(SLOT_CHANGED)
      } else if (
        failure instanceof ApiError &&
        failure.code === 'INVALID_BOOKING_POLICY'
      ) {
        invalidateSlot()
        setStep(1)
        setError(errorMessage(failure))
      } else if (failure instanceof ApiError && failure.status === 422) {
        invalidateSlot()
        setStep(0)
        setError(
          'Dados inválidos ou serviço indisponível. Atualize os serviços e revise sua seleção e seus dados.',
        )
      } else {
        if (!attemptedWrite) setSlotsRetryAt(retryAt(failure))
        else setPostRetryAt(retryAt(failure))
        setError(
          failure instanceof ApiError && failure.status === 503
            ? 'A confirmação está temporariamente indisponível. Tente novamente mais tarde.'
            : !attemptedWrite && !(failure instanceof ApiError)
              ? 'Não foi possível atualizar os horários. Nenhuma reserva foi enviada. Tente novamente.'
              : errorMessage(failure),
        )
      }
    } finally {
      clearTimeout(readTimeout)
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
    policy,
    policyLoading,
    policyError,
    policyRejected,
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
    refreshPolicy,
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
