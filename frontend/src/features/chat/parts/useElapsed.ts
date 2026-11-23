import { useEffect, useState } from 'react'
import { toMillis } from '@/lib/format'

/** Milliseconds between start and end (or now while running; ticks every second). */
export function useElapsed(startedAt: string | undefined, endedAt: string | null | undefined, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])
  const start = toMillis(startedAt)
  if (start === null) return null
  const end = running ? now : toMillis(endedAt)
  if (end === null) return null
  return Math.max(0, end - start)
}
