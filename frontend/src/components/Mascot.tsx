import { useId } from 'react'
import type { Message, Part } from '@/api/types'
import { cn } from '@/lib/cn'

export type MascotState = 'idle' | 'thinking' | 'working' | 'error'

interface Props {
  state?: MascotState
  size?: number
  /** When false the pose is static (animations are also off under prefers-reduced-motion). */
  animated?: boolean
  className?: string
}

export function mascotClass(state: MascotState, animated: boolean): string {
  return cn('mascot', `mascot--${state}`, !animated && 'mascot--still')
}

const TENTACLES = [
  'M14 34 c-4 6 -3 11 1 16',
  'M23 35 c3 6 4 11 0 16',
  'M32 35 c-3 6 -4 11 0 16',
  'M41 35 c3 6 4 11 0 16',
  'M50 34 c4 6 3 11 -1 16',
]

/** Original "Ensemble" octopus. Pure SVG + CSS keyframes (see index.css), no external assets. */
export function Mascot({ state = 'idle', size = 28, animated = true, className }: Props) {
  const gid = useId().replace(/:/g, '')
  const grad = `mg-${gid}`
  const err = state === 'error'
  return (
    <svg
      data-testid="mascot"
      data-state={state}
      data-animated={animated}
      className={cn(mascotClass(state, animated), className)}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={grad} x1="12" y1="6" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff8a7a" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <g className="m-all">
        <g className="m-tents" fill="none" stroke={`url(#${grad})`} strokeWidth="6" strokeLinecap="round">
          {TENTACLES.map((d) => (
            <path key={d} className="m-tent" d={d} />
          ))}
        </g>
        <path
          d="M11 34 C11 16 21 6 32 6 C43 6 53 16 53 34 C53 38 49 39 46 37 C42 40 38 40 32 40 C26 40 22 40 18 37 C15 39 11 38 11 34 Z"
          fill={`url(#${grad})`}
        />
        <ellipse cx="19" cy="31" rx="3.2" ry="2" fill="#fff" opacity="0.28" />
        <ellipse cx="45" cy="31" rx="3.2" ry="2" fill="#fff" opacity="0.28" />
        {err ? (
          <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none">
            <path d="M21.5 20.5 l7 7 M28.5 20.5 l-7 7" />
            <path d="M35.5 20.5 l7 7 M42.5 20.5 l-7 7" />
            <path d="M28 33 q4 -3 8 0" />
          </g>
        ) : (
          <g className="m-eyes">
            <circle cx="25" cy="25" r="5" fill="#fff" />
            <circle cx="39" cy="25" r="5" fill="#fff" />
            <circle className="m-pupil" cx="26" cy="26" r="2.4" fill="#1e1b3a" />
            <circle className="m-pupil" cx="40" cy="26" r="2.4" fill="#1e1b3a" />
            <path d="M29 33 q3 2.5 6 0" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </g>
        )}
      </g>
      {state === 'thinking' && (
        <g className="m-dots" fill="#8b5cf6">
          <circle cx="55" cy="12" r="1.6" />
          <circle cx="58.5" cy="7" r="2.1" />
          <circle cx="61" cy="1.8" r="2.6" />
        </g>
      )}
    </svg>
  )
}

function deepestRunning(parts: Part[]): Part | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p.type === 'subagent' && p.status === 'running') {
      return deepestRunning(p.parts) ?? p
    }
    if ((p.type === 'tool' || p.type === 'thinking') && p.status === 'running') return p
  }
  return null
}

/** Mascot pose for an assistant message: follows the part that is currently running. */
export function mascotStateFor(message: Message): MascotState {
  if (message.status === 'error') return 'error'
  if (message.status !== 'streaming') return 'idle'
  const running = deepestRunning(message.parts)
  if (running?.type === 'thinking') return 'thinking'
  if (running) return 'working'
  return message.parts.length === 0 ? 'thinking' : 'idle'
}
