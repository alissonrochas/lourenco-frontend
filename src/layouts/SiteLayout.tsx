import { NavLink, Outlet } from 'react-router'

export function SiteLayout() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
        <div className="grid md:grid-cols-2">
          <aside className="bg-slate-950 p-8 text-white md:p-10">
            <p className="text-sm uppercase tracking-[0.3em] text-slate-300">Lourenço Barbearia</p>
            <h1 className="mt-6 text-4xl font-bold tracking-tight">Gestão e atendimento em um lugar.</h1>
            <p className="mt-4 text-slate-300">
              Cadastro rápido com nome e telefone. Acesso da gestão exclusivo para administradores.
            </p>
            <nav aria-label="Navegação principal" className="mt-8 flex gap-3">
              {[{ to: '/', label: 'Cliente' }, { to: '/admin', label: 'Gestão' }].map(({ to, label }) => (
                <NavLink key={to} to={to} end className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium outline-offset-4 ${isActive
                    ? 'bg-white text-slate-950' : 'bg-slate-800 text-white hover:bg-slate-700'}`
                }>{label}</NavLink>
              ))}
            </nav>
          </aside>
          <section className="p-6 md:p-8"><Outlet /></section>
        </div>
      </div>
    </main>
  )
}
