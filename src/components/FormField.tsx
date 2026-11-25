import type { InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & { id: string; label: string }

export function FormField({ id, label, ...props }: Props) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
      <input
        {...props}
        id={id}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base outline-none ring-0 transition focus:border-slate-400 focus:bg-white"
      />
    </div>
  )
}
