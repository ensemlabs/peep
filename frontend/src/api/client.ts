import { detectLang } from '@/lib/lang'
import type {
  AdminUser, AuditAction, AuditItem, BulkAction, BulkResult, Me, ContextInfo, Conversation, FileMeta, Message, ModelsResponse, Plugin, PluginInput, Role, Skill, SkillDetail,
  TokenPeriod, User, UserStatus,
} from './types'

/** Headers sent on every API call: the backend localises model labels by Accept-Language. */
export function baseHeaders(): Record<string, string> {
  return { 'Accept-Language': detectLang() }
}

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function parseError(res: Response): Promise<ApiError> {
  let code = 'generic'
  let message = res.statusText
  try {
    const body = await res.json()
    if (body?.error) {
      code = String(body.error.code ?? code)
      message = String(body.error.message ?? message)
    }
  } catch {
    /* non-JSON error body */
  }
  const ra = res.headers.get('Retry-After')
  const retryAfter = ra && /^\d+$/.test(ra) ? Number(ra) : undefined
  return new ApiError(code, res.status, message, retryAfter)
}

function redirectToLogin() {
  const p = window.location.pathname
  if (p !== '/login' && p !== '/register') window.location.assign('/login')
}

/** Handle 401 for any non-auth endpoint by sending the user to /login. */
export function handleUnauthenticated(path: string, err: ApiError) {
  if (err.status === 401 && !path.startsWith('/api/auth/')) redirectToLogin()
}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...baseHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
  } catch {
    throw new ApiError('network', 0, 'network error')
  }
  if (!res.ok) {
    const err = await parseError(res)
    handleUnauthenticated(path, err)
    throw err
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const get = <T,>(p: string) => request<T>('GET', p)
const post = <T,>(p: string, b?: unknown) => request<T>('POST', p, b)
const patch = <T,>(p: string, b: unknown) => request<T>('PATCH', p, b)
const del = <T,>(p: string) => request<T>('DELETE', p)
const postForm = <T,>(p: string, f: FormData) => request<T>('POST', p, undefined, f)

export const api = {
  me: () => get<{ user: User; quota?: Me['quota'] }>('/api/auth/me').then((r): Me => ({ ...r.user, quota: r.quota })),
  login: (email: string, password: string) =>
    post<{ user: User }>('/api/auth/login', { email, password }).then((r) => r.user),
  register: (email: string, password: string, display_name: string) =>
    post<{ user: User }>('/api/auth/register', { email, password, display_name }).then((r) => r.user),
  logout: () => post<void>('/api/auth/logout'),
  changePassword: (current_password: string, new_password: string) =>
    post<void>('/api/auth/password', { current_password, new_password }),

  adminUsers: (p: { q?: string; status?: UserStatus | ''; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (p.q) qs.set('q', p.q)
    if (p.status) qs.set('status', p.status)
    qs.set('limit', String(p.limit ?? 100))
    qs.set('offset', String(p.offset ?? 0))
    return get<{ items: AdminUser[]; total: number }>(`/api/admin/users?${qs}`)
  },
  adminCreateUser: (body: { email: string; display_name: string; password: string; role: Role; status: 'active' | 'pending' }) =>
    post<{ user: User }>('/api/admin/users', body).then((r) => r.user),
  adminBulk: (ids: string[], action: BulkAction) => post<BulkResult>('/api/admin/users/bulk', { ids, action }),
  adminAudit: (p: { q?: string; action?: AuditAction | ''; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (p.q) qs.set('q', p.q)
    if (p.action) qs.set('action', p.action)
    qs.set('limit', String(p.limit ?? 50))
    qs.set('offset', String(p.offset ?? 0))
    return get<{ items: AuditItem[]; total: number }>(`/api/admin/audit?${qs}`)
  },
  adminPatchUser: (id: string, body: { status?: UserStatus; role?: Role; token_limit?: number | null; token_period?: TokenPeriod }) =>
    patch<{ user: User }>(`/api/admin/users/${id}`, body).then((r) => r.user),
  adminResetPassword: (id: string, new_password: string) =>
    post<void>(`/api/admin/users/${id}/password`, { new_password }),
  adminDeleteUser: (id: string) => del<void>(`/api/admin/users/${id}`),

  models: () => get<ModelsResponse>('/api/models'),
  context: (conversationId?: string) =>
    get<ContextInfo>(`/api/context${conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ''}`),

  skills: () => get<{ items: Skill[] }>('/api/skills'),
  uploadSkill: (file: File, replace = false) => {
    const f = new FormData()
    f.append('file', file)
    return postForm<{ skill: Skill }>(`/api/skills${replace ? '?replace=true' : ''}`, f).then((r) => r.skill)
  },
  skill: (id: string) => get<SkillDetail>(`/api/skills/${id}`),
  setSkillEnabled: (id: string, enabled: boolean) =>
    patch<{ skill: Skill }>(`/api/skills/${id}`, { enabled }).then((r) => r.skill),
  deleteSkill: (id: string) => del<void>(`/api/skills/${id}`),

  plugins: () => get<{ items: Plugin[] }>('/api/plugins'),
  createPlugin: (body: PluginInput) => post<{ plugin: Plugin }>('/api/plugins', body).then((r) => r.plugin),
  updatePlugin: (id: string, body: Partial<PluginInput> & { enabled?: boolean }) =>
    patch<{ plugin: Plugin }>(`/api/plugins/${id}`, body).then((r) => r.plugin),
  deletePlugin: (id: string) => del<void>(`/api/plugins/${id}`),
  importPlugins: (file: File) => {
    const f = new FormData()
    f.append('file', file)
    return postForm<{ created: Plugin[]; skipped: { name: string; reason: string }[] }>('/api/plugins/import', f)
  },

  conversations: (q = '', before?: string | null) => {
    const qs = new URLSearchParams({ limit: '50' })
    if (q) qs.set('q', q.slice(0, 200))
    if (before) qs.set('before', before)
    return get<{ items: Conversation[]; next_before: string | null }>(`/api/conversations?${qs}`)
  },
  createConversation: (body: { title?: string; model?: string }) =>
    post<{ conversation: Conversation }>('/api/conversations', body).then((r) => r.conversation),
  conversation: (id: string) =>
    get<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${id}`),
  patchConversation: (id: string, body: { title?: string; pinned?: boolean }) =>
    patch<{ conversation: Conversation }>(`/api/conversations/${id}`, body).then((r) => r.conversation),
  markRead: (id: string) => post<void>(`/api/conversations/${id}/read`),
  deleteConversation: (id: string) => del<void>(`/api/conversations/${id}`),

  deleteFile: (id: string) => del<void>(`/api/files/${id}`),
  stopMessage: (id: string) => post<void>(`/api/messages/${id}/stop`),
}

export interface SendBody {
  content: string
  attachment_ids: string[]
  /** Thinking level id; omitted for models without reasoning. */
  reasoning?: string
  /** Only sent when the server reports `switchable`. */
  model?: string
}

/** Upload with progress (XHR: fetch has no upload progress). */
export function buildUploadForm(file: File, conversationId?: string): FormData {
  const form = new FormData()
  form.append('file', file)
  // In an existing chat the server counts the unsent upload in that conversation's context.
  if (conversationId) form.append('conversation_id', conversationId)
  return form
}

export function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  opts: { conversationId?: string } = {},
): Promise<FileMeta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files')
    xhr.withCredentials = true
    xhr.responseType = 'text'
    for (const [k, v] of Object.entries(baseHeaders())) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onerror = () => reject(new ApiError('network', 0, 'network error'))
    xhr.onabort = () => reject(new ApiError('aborted', 0, 'aborted'))
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body && typeof body === 'object' && 'file' in body) {
        onProgress(1)
        resolve((body as { file: FileMeta }).file)
        return
      }
      const e = (body as { error?: { code?: string; message?: string } } | null)?.error
      const ra = xhr.getResponseHeader('Retry-After')
      const err = new ApiError(e?.code ?? 'generic', xhr.status, e?.message ?? 'upload failed', ra ? Number(ra) : undefined)
      handleUnauthenticated('/api/files', err)
      reject(err)
    }
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(buildUploadForm(file, opts.conversationId))
  })
}
