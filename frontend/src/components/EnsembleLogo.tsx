import { cn } from '@/lib/cn'

interface Props {
  size?: number
  className?: string
}

/**
 * The Ensemble mark: a thick rounded sigma with a small blue dot at its middle.
 * The stroke follows `--logo-ink` (navy in light theme, near-white in dark); the dot stays blue.
 */
export function EnsembleLogo({ size = 24, className }: Props) {
  return (
    <svg
      data-testid="ensemble-logo"
      className={cn('shrink-0', className)}
      width={size}
      height={size * (215 / 195)}
      viewBox="95 110 195 215"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M272 130H119L213 217L119 304H272"
        fill="none"
        stroke="var(--logo-ink, #0f1b3d)"
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="160" cy="222" r="14" fill="#4f7cf7" />
    </svg>
  )
}
