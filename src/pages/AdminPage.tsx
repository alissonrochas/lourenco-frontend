import { ServicesDashboard } from '@/components/admin/ServicesDashboard'
import { BookingDashboard } from '@/components/admin/BookingDashboard'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/FormField'
import { Feedback } from '@/components/Feedback'
import { useAdminSession } from '@/hooks/useAdminSession'

export function AdminPage() {
  const session = useAdminSession()
  const [section, setSection] = useState<'agenda' | 'services'>('agenda')
  const [servicesBusy, setServicesBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await session.login(email, password)) {
      setEmail('')
      setPassword('')
    }
  }

  if (session.status === 'checking') {
    return <p role="status">Verificando sessão…</p>
  }

  if (session.status === 'unavailable') {
    return (
      <div className="space-y-5">
        <h2 className="text-3xl font-semibold">Verificação de sessão indisponível</h2>
        <Feedback message={session.error} error />
        <Button type="button" onClick={session.retry}>Tentar novamente</Button>
      </div>
    )
  }

  if (session.status === 'authenticated' && session.user) {
    return (
      <div className="space-y-5">
        <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">Acesso da gestão</p>
        <h2 className="text-3xl font-semibold">Área administrativa</h2>
        <p>Olá, {session.user.fullName || session.user.email}.</p>

        <Feedback message={session.notice} />
        <Feedback message={session.error} error />
        <Button type="button" variant="secondary" className="w-full" onClick={session.logout} disabled={session.pending}>
          {session.pending ? 'Saindo…' : 'Sair da gestão'}
        </Button>
        {!session.pending && <>
          <nav className="admin-sections" aria-label="Seções administrativas">
            <button type="button" aria-current={section === 'agenda' ? 'page' : undefined} disabled={servicesBusy} onClick={() => setSection('agenda')}>Agenda</button>
            <button type="button" aria-current={section === 'services' ? 'page' : undefined} disabled={servicesBusy} onClick={() => setSection('services')}>Serviços</button>
          </nav>
          {section === 'agenda' ? <BookingDashboard onDenied={session.deny} /> : <ServicesDashboard onDenied={session.deny} onBusy={setServicesBusy} />}
        </>}
      </div>
    )
  }

  return (
    <form onSubmit={handleLogin} className="space-y-5" aria-labelledby="admin-title">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">Acesso da gestão</p>
        <h2 id="admin-title" className="mt-3 text-3xl font-semibold">Login do administrador</h2>
      </div>
      <FormField id="admin-email" label="E-mail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="gerencia@barbearia.com" required />
      <FormField id="admin-password" label="Senha" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="••••••••" required />
      <Button type="submit" className="w-full" disabled={session.pending}>{session.pending ? 'Entrando…' : 'Entrar na gestão'}</Button>
      <Feedback message={session.notice} />
      <Feedback message={session.error} error />
    </form>
  )
}
