import { useEffect } from 'react'
import { create } from 'zustand'
import { X } from 'lucide-react'
import { useT } from '@/i18n'

interface Toast {
  id: number
  message: string
}
interface ToastStore {
  toasts: Toast[]
  push: (message: string) => void
  dismiss: (id: number) => void
}

let seq = 0
export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (message) => set((s) => ({ toasts: [...s.toasts.slice(-3), { id: ++seq, message }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Visible feedback for actions that would otherwise fail silently. */
export function Toaster() {
  const t = useT()
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  useEffect(() => {
    const timers = toasts.map((x) => setTimeout(() => dismiss(x.id), 5000))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4">
      {toasts.map((x) => (
        <div key={x.id} role="alert" data-testid="toast" className="pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm shadow-lg">
          <span className="flex-1 text-danger">{x.message}</span>
          <button type="button" onClick={() => dismiss(x.id)} aria-label={t('common.close')} className="rounded p-0.5 text-muted hover:bg-hover">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
