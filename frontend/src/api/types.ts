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
  created_at: string
}

export interface Conversation {
  id: string
  title: string
  model: string | null
  updated_at: string
}

export interface ModelInfo {
  id: string
  label: string
  provider: 'openai' | 'replay'
  reasoning: boolean
}

export type Reasoning = 'off' | 'high'

export type StreamEvent =
  | { type: 'message'; data: { user_message: Message; assistant_message: Message } }
  | { type: 'part'; data: { message_id: string; parent_id: string | null; part: Part } }
  | { type: 'delta'; data: { message_id: string; part_id: string; field: 'text' | 'output'; text: string } }
  | { type: 'update'; data: { message_id: string; part_id: string; patch: Record<string, unknown> } }
  | { type: 'done'; data: { message_id: string; status: MessageStatus; error?: string | null } }
  | { type: 'snapshot'; data: { message: Message } }
