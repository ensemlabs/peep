import { useId } from 'react'
import { cn } from '@/lib/cn'

/** greet: waves once (~2 s) then falls into the idle loop by itself; pending: thought dots; error: X eyes. */
export type MascotState = 'greet' | 'idle' | 'pending' | 'error'

interface Props {
  state?: MascotState
  size?: number
  /** When false the pose is static. (Reduced motion also makes it static, in CSS.) */
  animated?: boolean
  className?: string
}

export function mascotClass(state: MascotState, animated: boolean): string {
  return cn('mascot', 'mascot-peep', `mascot--${state}`, !animated && 'mascot--still')
}

/**
 * "Peep": an original round chick. Pure SVG + CSS keyframes (index.css, scoped under .mascot-peep).
 * Animated parts: `.peep-float` (whole body), `.peep-body`, `.peep-eyes`, `.peep-limbL/R`, `.peep-extra`.
 */
export function Mascot({ state = 'idle', size = 28, animated = true, className }: Props) {
  const gid = `peep-${useId().replace(/:/g, '')}`
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
      <defs><linearGradient id={gid} x1=".2" y1="0" x2=".8" y2="1"><stop offset="0" stopColor="#ffec80"/><stop offset="1" stopColor="#ffb41c"/></linearGradient></defs>
      <g transform="translate(32 34) scale(.86) translate(-32 -34)"><ellipse className="peep-shadow" cx="32" cy="61.5" rx="14" ry="2.1" fill="#000" opacity=".2"/>
      <g className="peep-float"><g className="peep-body">
      <ellipse cx="25" cy="57" rx="4.4" ry="2.3" fill="#ff8a2a"/><ellipse cx="39" cy="57" rx="4.4" ry="2.3" fill="#ff8a2a"/>
      <path d="M32 14C46 14 55 25 55 37C55 49 46 57 32 57C18 57 9 49 9 37C9 25 18 14 32 14Z" fill={`url(#${gid})`}/>
      <g className="peep-extra" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"><path d="M28 15Q26 8 21 8.5"/><path d="M32 14.5Q32 6 35.5 5"/><path d="M36.5 15Q39.5 9 44 10"/></g>
      <ellipse cx="32" cy="47" rx="14" ry="9" fill="#fff3b8" opacity=".85"/>
      <ellipse cx="21.5" cy="22" rx="5.5" ry="2.6" fill="#fff" opacity=".5" transform="rotate(-30 21.5 22)"/>
      <ellipse cx="15.5" cy="40" rx="3.5" ry="2.4" fill="#ffa24a" opacity=".55"/><ellipse cx="48.5" cy="40" rx="3.5" ry="2.4" fill="#ffa24a" opacity=".55"/>
      <g className="peep-face-ok"><g className="peep-gaze"><g className="peep-eyes"><g fill="#3a2410"><ellipse cx="22.5" cy="31" rx="3.4" ry="4.6"/><ellipse cx="41.5" cy="31" rx="3.4" ry="4.6"/></g><circle cx="23.8" cy="29.2" r="1.6" fill="#fff"/><circle cx="42.8" cy="29.2" r="1.6" fill="#fff"/></g></g></g>
      <path d="M27.5 35.5Q32 32.2 36.5 35.5Q35.5 40.2 32 41Q28.5 40.2 27.5 35.5Z" fill="#ff8a2a"/>
      <g className="peep-face-ok"><ellipse className="peep-smile" cx="32" cy="40.6" rx="2.9" ry="1.3" fill="#f06a1a"/></g>
      <path className="peep-happy" d="M18.8 32.5Q22.5 26  26.2 32.5M37.8 32.5Q41.5 26  45.2 32.5" fill="none" stroke="#3a2410" strokeWidth="2.4" strokeLinecap="round"/><ellipse className="peep-open" cx="32" cy="41.6" rx="3.3" ry="3" fill="#9c2f18"/><g className="peep-face-err"><path d="M19.5 27.5l6 6M25.5 27.5l-6 6M38.5 27.5l6 6M44.5 27.5l-6 6M28.5 44q1.6-2.2 3.2 0t3.2 0" fill="none" stroke="#3a2410" strokeWidth="2.4" strokeLinecap="round"/></g>
      <g className="peep-limbL"><ellipse cx="9" cy="41" rx="4.8" ry="7.5" transform="rotate(16 9 41)" fill="#ffae14"/></g>
      <g className="peep-limbR"><ellipse cx="55" cy="41" rx="4.8" ry="7.5" transform="rotate(-16 55 41)" fill="#ffae14"/></g>
      </g></g></g>
      <g className="peep-dots" fill="#f5a30c"><circle className="d1" cx="48" cy="12" r="2.1"/><circle className="d2" cx="53" cy="8.5" r="2.7"/><circle className="d3" cx="57.5" cy="5.5" r="3.3"/></g>
    </svg>
  )
}
