import type {
  Conversation, FileMeta, Message, ModelInfo, Reasoning, Role, User, UserStatus,
} from './types'

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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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

export const api = {
  me: () => get<{ user: User }>('/api/auth/me').then((r) => r.user),
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
    return get<{ items: User[]; total: number }>(`/api/admin/users?${qs}`)
  },
  adminPatchUser: (id: string, body: { status?: UserStatus; role?: Role }) =>
    patch<{ user: User }>(`/api/admin/users/${id}`, body).then((r) => r.user),
  adminResetPassword: (id: string, new_password: string) =>
    post<void>(`/api/admin/users/${id}/password`, { new_password }),
  adminDeleteUser: (id: string) => del<void>(`/api/admin/users/${id}`),

  models: () => get<{ items: ModelInfo[]; default: string }>('/api/models'),

  conversations: () => get<{ items: Conversation[] }>('/api/conversations?limit=100'),
  createConversation: (body: { title?: string; model?: string }) =>
    post<{ conversation: Conversation }>('/api/conversations', body).then((r) => r.conversation),
  conversation: (id: string) =>
    get<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${id}`),
  renameConversation: (id: string, title: string) =>
    patch<{ conversation: Conversation }>(`/api/conversations/${id}`, { title }).then((r) => r.conversation),
  deleteConversation: (id: string) => del<void>(`/api/conversations/${id}`),

  stopMessage: (id: string) => post<void>(`/api/messages/${id}/stop`),
}

export interface SendBody {
  content: string
  attachment_ids: string[]
  model: string
  reasoning: Reasoning
}

/** Upload with progress (XHR: fetch has no upload progress). */
export function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<FileMeta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files')
    xhr.withCredentials = true
    xhr.responseType = 'text'
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
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}
