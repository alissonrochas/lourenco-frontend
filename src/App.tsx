import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'

type Screen = 'client' | 'admin'

type ApiErrorPayload = {
  message?: string
  errors?: Record<string, string[]>
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

  const handleClientSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setClientStatus(null)
    setClientError(null)

    try {
      const response = await fetch('http://localhost:3333/api/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: clientName,
          phone: clientPhone,
        }),
      })

      const payload = (await response.json()) as ApiErrorPayload & { name?: string; phone?: string }

      if (!response.ok) {
        const firstError = payload.errors ? Object.values(payload.errors)[0]?.[0] : payload.message
        throw new Error(firstError || 'Não foi possível cadastrar o cliente.')
      }

      setClientStatus(`Cliente cadastrado com sucesso: ${payload.name}`)
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
      const response = await fetch('http://localhost:3333/api/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: adminEmail,
          password: adminPassword,
        }),
      })

      const payload = (await response.json()) as ApiErrorPayload & { user?: { fullName?: string } }

      if (!response.ok) {
        const firstError = payload.errors ? Object.values(payload.errors)[0]?.[0] : payload.message
        throw new Error(firstError || 'Credenciais inválidas.')
      }

      setAdminStatus(`Login realizado com sucesso${payload.user?.fullName ? ` para ${payload.user.fullName}` : ''}.`)
      setAdminEmail('')
      setAdminPassword('')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Erro inesperado.')
    }
  }

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
          </section>
        </div>
      </div>
    </main>
  )
}

export default App
