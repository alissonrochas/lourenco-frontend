type Props = { message: string | null; error?: boolean }

export function Feedback({ message, error = false }: Props) {
  if (!message) return null
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={`rounded-xl border px-3 py-2 text-sm ${error
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}
    >
      {message}
    </p>
  )
}
