import { create } from 'zustand'
import type { Message, Reasoning } from '@/api/types'
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
  model: string | null
  setModel: (id: string) => void
  reasoning: Reasoning
  setReasoning: (r: Reasoning) => void
}

export const useUiStore = create<UiStore>((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  model: readStorage('ec_model'),
  setModel: (model) => {
    writeStorage('ec_model', model)
    set({ model })
  },
  reasoning: readStorage('ec_reasoning') === 'high' ? 'high' : 'off',
  setReasoning: (reasoning) => {
    writeStorage('ec_reasoning', reasoning)
    set({ reasoning })
  },
}))
