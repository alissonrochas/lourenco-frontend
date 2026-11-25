import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/FormField'
import { Feedback } from '@/components/Feedback'
import { errorMessage, submitCustomer } from '@/lib/api'

export function PublicPage() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setNotice(null)
    setError(null)
    try {
      setNotice(await submitCustomer(name, phone))
      setName('')
      setPhone('')
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-labelledby="customer-title">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">Cadastro do cliente</p>
        <h2 id="customer-title" className="mt-3 text-3xl font-semibold">Novo cliente</h2>
      </div>
      <FormField id="client-name" label="Nome completo" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Ex: João da Silva" minLength={2} maxLength={120} required />
      <FormField id="client-phone" label="Telefone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="(11) 99999-1234" maxLength={30} required />
      <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Enviando…' : 'Cadastrar cliente'}</Button>
      <Feedback message={notice} />
      <Feedback message={error} error />
    </form>
  )
}
