export type Role = 'user' | 'admin'
export type UserStatus = 'pending' | 'active' | 'disabled'

export interface User {
  id: string
  email: string
  display_name: string
  role: Role
  status: UserStatus
  created_at: string
  last_login_at: string | null
  approved_at: string | null
}

export type FileKind = 'image' | 'video' | 'audio' | 'file'

export interface FileMeta {
  id: string
  kind: FileKind
  mime: string
  filename: string
  size: number
  width?: number | null
  height?: number | null
  url: string
  thumb_url?: string | null
  download_url: string
}

export type StepStatus = 'running' | 'done' | 'error'

export interface ThinkingPart {
  id: string
  type: 'thinking'
  text: string
  status: 'running' | 'done'
  started_at: string
  ended_at?: string | null
}
export interface TextPart {
  id: string
  type: 'text'
  text: string
}
export interface ToolPart {
  id: string
  type: 'tool'
  name: string
  input: unknown
  output: string | null
  files: FileMeta[]
  status: StepStatus
  started_at: string
  ended_at?: string | null
}
export interface SubagentPart {
  id: string
  type: 'subagent'
  name: string
  task: string
  status: StepStatus
  parts: Part[]
  started_at: string
  ended_at?: string | null
}
export interface FilesPart {
  id: string
  type: 'files'
  files: FileMeta[]
}
export type Part = ThinkingPart | TextPart | ToolPart | SubagentPart | FilesPart

export type MessageStatus = 'streaming' | 'complete' | 'error' | 'stopped'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments: FileMeta[]
  parts: Part[]
  status: MessageStatus
  model: string
  error?: string | null
  usage?: Usage | null
  created_at: string
}

export type ConversationStatus = 'idle' | 'streaming' | 'complete' | 'error' | 'stopped'

export interface Conversation {
  id: string
  title: string
  model: string | null
  updated_at: string
  /** Derived from the last assistant message (list endpoint only). */
  status?: ConversationStatus
  /** The last assistant message finished after the conversation was last read. */
  unread?: boolean
  /** <= 100 chars of the last text, markdown stripped. */
  preview?: string
  pinned?: boolean
}

export interface ReasoningLevel {
  id: string
  label: string
}

export interface ReasoningConfig {
  levels: ReasoningLevel[]
  default: string
  returns_text?: boolean
}

export interface ModelInfo {
  id: string
  label: string
  provider: string
  vision?: boolean
  context_window: number
  /** Typical token cost of one attached image, when known. */
  image_tokens?: number | null
  reasoning: ReasoningConfig | null
}

export interface ModelsResponse {
  switchable: boolean
  active: ModelInfo
  items: ModelInfo[]
}

export interface Usage {
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  total_tokens: number
  source: 'provider' | 'estimate'
}

export type ContextKey = 'system' | 'user_messages' | 'assistant_messages' | 'attachments' | 'tool_results' | 'skills'

export interface ContextInfo {
  model_id: string
  context_window: number
  used_tokens: number
  free_tokens?: number
  estimated: boolean
  breakdown: { key: ContextKey; tokens: number; items?: { name: string; tokens: number }[] }[]
  last_usage: Usage | null
  totals: {
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number | null
    cache_write_tokens: number | null
    messages: number
  }
}

export interface Skill {
  id: string
  name: string
  description: string
  version: string | null
  enabled: boolean
  size: number
  file_count: number
  created_at: string
  updated_at: string
}

export interface SkillDetail {
  skill: Skill
  files: { path: string; size: number }[]
  skill_md: string
}

export type PluginTransport = 'http' | 'sse'

export interface Plugin {
  id: string
  name: string
  description: string | null
  transport: PluginTransport
  url: string
  headers: { name: string; value_masked: string }[]
  enabled: boolean
  created_at: string
  updated_at: string
}

/** value === null on update means "keep the stored value". */
export interface PluginInput {
  name: string
  description?: string | null
  transport: PluginTransport
  url: string
  headers: { name: string; value: string | null }[]
}

export type StreamEvent =
  | { type: 'message'; data: { user_message: Message; assistant_message: Message } }
  | { type: 'part'; data: { message_id: string; parent_id: string | null; part: Part } }
  | { type: 'delta'; data: { message_id: string; part_id: string; field: 'text' | 'output'; text: string } }
  | { type: 'update'; data: { message_id: string; part_id: string; patch: Record<string, unknown> } }
  | { type: 'done'; data: { message_id: string; status: MessageStatus; error?: string | null } }
  | { type: 'usage'; data: { message_id: string; usage: Usage } }
  | { type: 'snapshot'; data: { message: Message } }
