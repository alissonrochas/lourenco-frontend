import { Button } from '@/components/ui/button'

function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-16 text-slate-900">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-lg shadow-slate-200/60">
        <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
          Barbearia
        </p>
        <h1 className="text-4xl font-bold tracking-tight">Frontend React com shadcn/ui</h1>
        <p className="mt-4 text-base text-slate-600">
          Projeto pronto para evoluir com componentes reutilizáveis, layout moderno e integração
          com o backend AdonisJS.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button>Agendar horário</Button>
          <Button variant="secondary">Ver serviços</Button>
        </div>
      </div>
    </main>
  )
}

export default App
