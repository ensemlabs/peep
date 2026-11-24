import { useId } from 'react'
import type { Message, Part } from '@/api/types'
import { cn } from '@/lib/cn'

export type MascotState = 'idle' | 'thinking' | 'working' | 'error'

interface Props {
  state?: MascotState
  size?: number
  /** When false the pose is static (animations are also off under prefers-reduced-motion). */
  animated?: boolean
  /** Walking gait (feet/arms swing, body bobs); the parent moves it. */
  walking?: boolean
  className?: string
}

export function mascotClass(state: MascotState, animated: boolean, walking = false): string {
  return cn('mascot', 'mascot-pip', `mascot--${state}`, !animated && 'mascot--still', walking && animated && 'mascot--walk')
}

/** "Pip": an original little robot. Pure SVG + CSS keyframes (index.css, scoped under .mascot-pip). */
export function Mascot({ state = 'idle', size = 28, animated = true, walking = false, className }: Props) {
  const gid = `pip-${useId().replace(/:/g, '')}`
  return (
    <svg
      data-testid="mascot"
      data-state={state}
      data-animated={animated}
      data-walking={walking && animated}
      className={cn(mascotClass(state, animated, walking), className)}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs><linearGradient id={gid} x1=".15" y1="0" x2=".85" y2="1"><stop offset="0" stopColor="#78f3df"/><stop offset="1" stopColor="#119f98"/></linearGradient></defs>
      <g transform="translate(32 34) scale(.92) translate(-32 -34)"><ellipse className="pip-shadow" cx="32" cy="61" rx="15" ry="2.2" fill="#000" opacity=".2"/>
      <g className="pip-float"><g className="pip-body">
      <g className="pip-antenna"><rect x="30.5" y="12" width="3" height="9" rx="1.5" fill="#0c8780"/>
      <g className="pip-bulb"><circle className="pip-glow" cx="32" cy="9" r="7" fill="#ffd166" opacity=".35"/><circle cx="32" cy="9" r="4.3" fill="#ffd166"/><circle cx="30.7" cy="7.7" r="1.3" fill="#fff" opacity=".85"/></g></g>
      <ellipse className="pip-footL" cx="23" cy="56.5" rx="6" ry="3" fill="#0c8780"/><ellipse className="pip-footR" cx="41" cy="56.5" rx="6" ry="3" fill="#0c8780"/>
      <ellipse className="pip-armL" cx="8.5" cy="42" rx="4.2" ry="6" fill="#0e948d"/><ellipse className="pip-armR" cx="55.5" cy="42" rx="4.2" ry="6" fill="#0e948d"/>
      <path d="M32 17C46 17 54 30 54 41C54 51 45 57 32 57C19 57 10 51 10 41C10 30 18 17 32 17Z" fill={`url(#${gid})`}/>
      <ellipse cx="21.5" cy="26" rx="5" ry="2.8" fill="#fff" opacity=".4" transform="rotate(-35 21.5 26)"/>
      <rect x="16" y="29" width="32" height="21" rx="10" fill="#0f2f3a"/>
      <g className="pip-face-ok"><g className="pip-gaze"><g className="pip-eyes" fill="#7ff5e0"><rect x="21.5" y="33.5" width="7" height="9" rx="3.5"/><rect x="35.5" y="33.5" width="7" height="9" rx="3.5"/></g></g>
      <path d="M29 45.5q3 2.6 6 0" fill="none" stroke="#7ff5e0" strokeWidth="1.8" strokeLinecap="round"/>
      <circle cx="19.5" cy="45" r="2" fill="#ff8fab" opacity=".75"/><circle cx="44.5" cy="45" r="2" fill="#ff8fab" opacity=".75"/></g>
      <g className="pip-face-err"><g fill="none" stroke="#ff8a80" strokeWidth="2.6" strokeLinecap="round"><path d="M22.5 35l6 6M28.5 35l-6 6M35.5 35l6 6M41.5 35l-6 6"/><path d="M27.5 46.5q1.6-2.2 3.2 0t3.2 0 3.2 0" strokeWidth="2"/></g></g></g>
      </g></g>
      <g className="pip-dots" fill="#19b8a8"><circle className="d1" cx="46" cy="13" r="1.6"/><circle className="d2" cx="52" cy="8.5" r="2.1"/><circle className="d3" cx="58.5" cy="4.5" r="2.7"/></g>
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
