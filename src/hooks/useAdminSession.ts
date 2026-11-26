import { useCallback, useEffect, useState } from 'react'
import { errorMessage, getAdminSession, isSessionDenied, loginAdmin, logoutAdmin, type AdminUser } from '@/lib/api'

type SessionStatus = 'checking' | 'guest' | 'authenticated' | 'unavailable'

export function useAdminSession() {
  const [status, setStatus] = useState<SessionStatus>('checking')
  const [user, setUser] = useState<AdminUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getAdminSession(controller.signal)
      .then((currentUser) => {
        if (controller.signal.aborted) return
        setUser(currentUser)
        setStatus('authenticated')
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setUser(null)
        if (isSessionDenied(failure)) {
          setStatus('guest')
          if (failure instanceof Error && 'status' in failure && failure.status === 403) {
            setError(errorMessage(failure))
          }
        } else {
          // A network/CSRF/server error does not mean the server session has ended.
          setStatus('unavailable')
          setError(errorMessage(failure))
        }
      })
    return () => controller.abort()
  }, [attempt])

  async function login(email: string, password: string) {
    if (pending) return false
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const currentUser = await loginAdmin(email, password)
      setUser(currentUser)
      setStatus('authenticated')
      setNotice('Login realizado com sucesso.')
      return true
    } catch (failure) {
      setError(errorMessage(failure))
      return false
    } finally {
      setPending(false)
    }
  }

  async function logout() {
    if (pending) return
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      await logoutAdmin()
      setUser(null)
      setStatus('guest')
      setNotice('Sessão encerrada com sucesso.')
    } catch (failure) {
      if (isSessionDenied(failure)) {
        setUser(null)
        setStatus('guest')
      }
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  const deny = useCallback((failure: unknown) => {
    setUser(null)
    setStatus('guest')
    setNotice(null)
    setError(errorMessage(failure))
  }, [])

  function retry() {
    setStatus('checking')
    setError(null)
    setAttempt((value) => value + 1)
  }

  return { status, user, error, notice, pending, login, logout, retry, deny }
}
