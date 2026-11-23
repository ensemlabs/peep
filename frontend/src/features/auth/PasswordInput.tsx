import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useT } from '@/i18n'
import { inputClass } from '@/components/ui/styles'
import { cn } from '@/lib/cn'

export function PasswordInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const t = useT()
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input {...rest} type={shown ? 'text' : 'password'} className={cn(inputClass, 'pr-10', className)} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t('common.hidePassword') : t('common.showPassword')}
        aria-pressed={shown}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted hover:bg-hover"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}
