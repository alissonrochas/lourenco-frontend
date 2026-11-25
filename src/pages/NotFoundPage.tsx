import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="space-y-5">
      <h2 className="text-3xl font-semibold">Página não encontrada</h2>
      <Link to="/" className="underline">Voltar para a página pública</Link>
    </div>
  )
}
