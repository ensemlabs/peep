import type { Conversation, ConversationStatus } from '@/api/types'

export type Indicator = 'streaming' | 'unread' | 'error' | null

/** Effective status: a run this client is driving wins over the (possibly stale) server value. */
export function effectiveStatus(conv: Pick<Conversation, 'status'>, live: boolean): ConversationStatus {
  return live ? 'streaming' : (conv.status ?? 'idle')
}

/**
 * One quiet slot per row: a thin spinner while waiting, a dot for a finished unread chat,
 * a muted red dot for a failed unread one. Read or stopped chats show nothing.
 */
export function indicatorFor(status: ConversationStatus, unread: boolean): Indicator {
  if (status === 'streaming') return 'streaming'
  if (!unread) return null
  if (status === 'error') return 'error'
  if (status === 'complete') return 'unread'
  return null
}

export interface Groups {
  pinned: Conversation[]
  today: Conversation[]
  week: Conversation[]
  month: Conversation[]
  older: Conversation[]
}

export function groupConversations(items: Conversation[], now = Date.now()): Groups {
  const sod = new Date(now)
  sod.setHours(0, 0, 0, 0)
  const day = 86_400_000
  const g: Groups = { pinned: [], today: [], week: [], month: [], older: [] }
  for (const c of items) {
    const ts = Date.parse(c.updated_at)
    if (c.pinned) g.pinned.push(c)
    else if (ts >= sod.getTime()) g.today.push(c)
    else if (ts >= sod.getTime() - 7 * day) g.week.push(c)
    else if (ts >= sod.getTime() - 30 * day) g.month.push(c)
    else g.older.push(c)
  }
  return g
}

export function unreadCount(items: Conversation[]): number {
  return items.filter((c) => c.unread && (c.status === 'complete' || c.status === 'error')).length
}
