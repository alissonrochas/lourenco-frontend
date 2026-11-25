import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'

type Screen = 'client' | 'admin'

const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''

type ApiErrorPayload = {
  code?: string
  message?: string
  errors?: Record<string, string[]>
}

async function readApiPayload(response: Response) {
  try {
    return (await response.json()) as ApiErrorPayload
  } catch {
    return {}
  }
}

function getApiErrorMessage(response: Response, payload: ApiErrorPayload, fallback: string) {
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    return retryAfter
      ? `Muitas tentativas. Tente novamente em ${retryAfter} segundos.`
      : 'Muitas tentativas. Aguarde antes de tentar novamente.'
  }

  if (response.status === 403 && payload.code === 'E_BAD_CSRF_TOKEN') {
    return 'Sessão CSRF expirada. Atualize a página e tente novamente.'
  }

  if (response.status === 419) {
    return 'Sessão CSRF expirada. Atualize a página e tente novamente.'
  }

  if (response.status === 401) {
    return payload.message || 'Credenciais inválidas ou sessão expirada.'
  }

  const firstError = payload.errors ? Object.values(payload.errors)[0]?.[0] : payload.message
  return firstError || fallback
}

function App() {
  const [screen, setScreen] = useState<Screen>('client')

  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientStatus, setClientStatus] = useState<string | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)

  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminStatus, setAdminStatus] = useState<string | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminAuthenticated, setAdminAuthenticated] = useState(false)

  const handleClientSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setClientStatus(null)
    setClientError(null)

    try {
      const response = await apiFetch('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: clientName,
          phone: clientPhone,
        }),
      })

      const payload = await readApiPayload(response)

      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, payload, 'Não foi possível cadastrar o cliente.'))
      }

      setClientStatus(payload.message || 'Solicitação recebida.')
      setClientName('')
      setClientPhone('')
    } catch (error) {
      setClientError(error instanceof Error ? error.message : 'Erro inesperado.')
    }
  }

  const handleAdminSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAdminStatus(null)
    setAdminError(null)

    try {
      const response = await apiFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          email: adminEmail,
          password: adminPassword,
        }),
      })

      const payload = (await readApiPayload(response)) as ApiErrorPayload & { user?: { fullName?: string } }

      if (!response.ok) {
        const errorMessage = getApiErrorMessage(response, payload, 'Credenciais inválidas.')
        throw new Error(errorMessage)
      }

      setAdminStatus(`Login realizado com sucesso${payload.user?.fullName ? ` para ${payload.user.fullName}` : ''}.`)
      setAdminEmail('')
      setAdminPassword('')
      setAdminAuthenticated(true)
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Erro inesperado.')
    }
  }

  const handleAdminLogout = async () => {
    setAdminStatus(null)
    setAdminError(null)

    try {
      const response = await apiFetch('/api/admin/logout', { method: 'POST' })

      if (!response.ok) {
        const payload = await readApiPayload(response)
        throw new Error(getApiErrorMessage(response, payload, 'Não foi possível sair da gestão.'))
      }

      setAdminAuthenticated(false)
      setAdminStatus('Sessão encerrada com sucesso.')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Erro inesperado.')
    }
  }

  function getXsrfToken() {
    const cookie = document.cookie
      .split('; ')
      .find((item) => item.startsWith('XSRF-TOKEN='))

    return cookie ? decodeURIComponent(cookie.slice('XSRF-TOKEN='.length)) : undefined
  }

  async function primeCsrf() {
    await fetch(`${API_URL}/api/csrf`, {
      credentials: 'include',
    })
  }

  async function apiFetch(path: string, init: RequestInit = {}) {
    let xsrfToken = getXsrfToken()

    if (!xsrfToken) {
      await primeCsrf()
      xsrfToken = getXsrfToken()
    }

    return fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.headers || {}),
        ...(xsrfToken ? { 'X-XSRF-TOKEN': xsrfToken } : {}),
      },
    })
  }

  useEffect(() => {
    primeCsrf()
      .then(() => apiFetch('/api/admin/me'))
      .then((response) => setAdminAuthenticated(response.ok))
      .catch(() => setAdminAuthenticated(false))
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
        <div className="grid md:grid-cols-2">
          <aside className="bg-slate-950 p-8 text-white md:p-10">
            <p className="text-sm uppercase tracking-[0.3em] text-slate-300">Lourenço Barbearia</p>
            <h1 className="mt-6 text-4xl font-bold tracking-tight">Gestão e atendimento em um lugar.</h1>
            <p className="mt-4 text-slate-300">
              Comece pelo cliente, validando cadastro rápido com nome e telefone, e deixe o acesso da
              gestão exclusivo para o login administrativo.
            </p>

            <div className="mt-8 flex gap-3">
              <Button type="button" variant={screen === 'client' ? 'default' : 'secondary'} onClick={() => setScreen('client')}>
                Cliente
              </Button>
              <Button type="button" variant={screen === 'admin' ? 'default' : 'secondary'} onClick={() => setScreen('admin')}>
                Gestão
              </Button>
            </div>
          </aside>

          <section className="p-6 md:p-8">
            {screen === 'client' ? (
              <form onSubmit={handleClientSubmit} className="space-y-5">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">Cadastro do cliente</p>
                  <h2 className="mt-3 text-3xl font-semibold">Novo cliente</h2>
                </div>

                <div className="space-y-2">
                  <label htmlFor="client-name" className="text-sm font-medium text-slate-700">
                    Nome completo
                  </label>
                  <input
                    id="client-name"
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base outline-none ring-0 transition focus:border-slate-400 focus:bg-white"
                    placeholder="Ex: João da Silva"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="client-phone" className="text-sm font-medium text-slate-700">
                    Telefone
                  </label>
                  <input
                    id="client-phone"
                    value={clientPhone}
                    onChange={(event) => setClientPhone(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base outline-none ring-0 transition focus:border-slate-400 focus:bg-white"
                    placeholder="(11) 99999-1234"
                    required
                  />
                </div>

                <Button type="submit" className="w-full">Cadastrar cliente</Button>

                {clientStatus && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{clientStatus}</p>}
                {clientError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{clientError}</p>}
              </form>
            ) : (
              <form onSubmit={handleAdminSubmit} className="space-y-5">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">Acesso da gestão</p>
                  <h2 className="mt-3 text-3xl font-semibold">Login do administrador</h2>
                </div>

                <div className="space-y-2">
                  <label htmlFor="admin-email" className="text-sm font-medium text-slate-700">
                    E-mail
                  </label>
                  <input
                    id="admin-email"
                    type="email"
                    value={adminEmail}
                    onChange={(event) => setAdminEmail(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base outline-none ring-0 transition focus:border-slate-400 focus:bg-white"
                    placeholder="gerencia@barbearia.com"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="admin-password" className="text-sm font-medium text-slate-700">
                    Senha
                  </label>
                  <input
                    id="admin-password"
                    type="password"
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base outline-none ring-0 transition focus:border-slate-400 focus:bg-white"
                    placeholder="••••••••"
                    required
                  />
                </div>

                <Button type="submit" className="w-full">Entrar na gestão</Button>

                {adminStatus && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{adminStatus}</p>}
                {adminError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{adminError}</p>}
              </form>
            )}

            {adminAuthenticated && (
              <Button type="button" variant="secondary" className="w-full" onClick={handleAdminLogout}>
                Sair da gestão
              </Button>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

export default App
