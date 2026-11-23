import { create } from 'zustand'
import type { Message } from '@/api/types'
import { loadLevels, saveLevel } from '@/lib/reasoning'
import { readStorage, writeStorage } from '@/lib/storage'

export interface LiveRun {
  user: Message | null
  assistant: Message | null
  controller: AbortController
  error: string | null // an ApiError code or 'network'
}

interface RunStore {
  runs: Record<string, LiveRun>
  setRun: (conversationId: string, run: LiveRun) => void
  clearRun: (conversationId: string) => void
  abortAll: () => void
}

export const useRunStore = create<RunStore>((set, get) => ({
  runs: {},
  setRun: (id, run) => set((s) => ({ runs: { ...s.runs, [id]: run } })),
  clearRun: (id) =>
    set((s) => {
      const { [id]: _drop, ...rest } = s.runs
      void _drop
      return { runs: rest }
    }),
  abortAll: () => {
    Object.values(get().runs).forEach((r) => r.controller.abort())
    set({ runs: {} })
  },
}))

interface UiStore {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  /** Desktop: sidebar hidden (persisted). */
  collapsed: boolean
  setCollapsed: (c: boolean) => void
  model: string | null
  setModel: (id: string) => void
  /** Chosen thinking level per model id (persisted). */
  levels: Record<string, string>
  setLevel: (modelId: string, level: string) => void
}

export const useUiStore = create<UiStore>((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  collapsed: readStorage('ec_sidebar_collapsed') === '1',
  setCollapsed: (collapsed) => {
    writeStorage('ec_sidebar_collapsed', collapsed ? '1' : '0')
    set({ collapsed })
  },
  model: readStorage('ec_model'),
  setModel: (model) => {
    writeStorage('ec_model', model)
    set({ model })
  },
  levels: loadLevels(),
  setLevel: (modelId, level) => set((st) => ({ levels: saveLevel(st.levels, modelId, level) })),
}))
