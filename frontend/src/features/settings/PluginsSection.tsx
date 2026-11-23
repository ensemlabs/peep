import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { api } from '@/api/client'
import type { Plugin, PluginTransport } from '@/api/types'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Spinner } from '@/components/ui/Spinner'
import { inputClass, labelClass } from '@/components/ui/styles'
import { Switch } from './Switch'
import { useToasts } from '@/components/Toaster'
import { buildHeaders, newRow, renamedWithoutValue, toHeaderRows, type HeaderRow } from './plugins'

const KEY = ['plugins'] as const

export function PluginsSection() {
  const { t, err } = useI18n()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: KEY, queryFn: api.plugins })
  const importRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<Plugin | 'new' | null>(null)
  const [del, setDel] = useState<Plugin | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const toast = useToasts((s) => s.push)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: KEY })
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => api.updatePlugin(v.id, { enabled: v.enabled }),
    onSuccess: refresh,
    onError: (e) => toast(err(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deletePlugin(id),
    onSuccess: () => {
      setDel(null)
      refresh()
    },
    onError: (e) => {
      setDel(null)
      toast(err(e))
    },
  })
  const imp = useMutation({
    mutationFn: (f: File) => api.importPlugins(f),
    onSuccess: (r) => {
      setError(null)
      const skipped = r.skipped.length ? ` ${r.skipped.map((x) => `${x.name} (${x.reason})`).join(', ')}` : ''
      setNote(t('plugins.importResult', { created: r.created.length, skipped: r.skipped.length }) + skipped)
      refresh()
    },
    onError: (e) => {
      setNote(null)
      setError(err(e))
    },
  })
  const items = list.data?.items ?? []

  return (
    <section data-testid="plugins-section">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('plugins.title')}</h2>
          <p className="mt-0.5 text-sm text-muted">{t('plugins.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={importRef}
            type="file"
            hidden
            accept=".json,application/json"
            data-testid="plugin-import"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) imp.mutate(f)
              e.target.value = ''
            }}
          />
          <Button size="sm" onClick={() => importRef.current?.click()} disabled={imp.isPending}>
            {imp.isPending ? <Spinner /> : <Upload className="size-4" />}
            {t('plugins.import')}
          </Button>
          <Button size="sm" variant="primary" data-testid="plugin-add" onClick={() => setEditing('new')}>
            <Plus className="size-4" />
            {t('plugins.add')}
          </Button>
        </div>
      </div>
      {note && <p role="status" data-testid="plugin-import-result" className="mt-3 text-sm text-success">{note}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {list.isError && <p role="alert" className="mt-3 text-sm text-danger">{err(list.error)}</p>}

      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {items.length === 0 && !list.isLoading && <li className="px-4 py-6 text-center text-sm text-muted">{t('plugins.empty')}</li>}
        {items.map((p) => (
          <li key={p.id} data-testid="plugin-row" data-name={p.name} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{p.name}</span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] uppercase text-muted">{p.transport}</span>
              </div>
              <div className="truncate font-mono text-xs text-muted" title={p.url}>{p.url}</div>
              {p.headers.length > 0 && (
                <div className="mt-0.5 text-xs text-muted" data-testid="plugin-headers">
                  {p.headers.map((h) => `${h.name}: ${h.value_masked}`).join(' · ')}
                </div>
              )}
            </div>
            <Switch checked={p.enabled} label={t('plugins.toggle', { name: p.name })} testId="plugin-toggle" onChange={(enabled) => toggle.mutate({ id: p.id, enabled })} />
            <Button size="icon" variant="ghost" aria-label={`${t('plugins.edit')}: ${p.name}`} data-testid="plugin-edit" onClick={() => setEditing(p)}>
              <Pencil className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label={`${t('common.delete')}: ${p.name}`} data-testid="plugin-delete" onClick={() => setDel(p)}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>

      {editing && <PluginDialog plugin={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
      {del && (
        <Dialog
          open
          onOpenChange={(o) => !o && setDel(null)}
          title={t('plugins.deleteTitle', { name: del.name })}
          description={t('plugins.deleteBody')}
          footer={
            <>
              <Button onClick={() => setDel(null)}>{t('common.cancel')}</Button>
              <Button variant="danger" data-testid="plugin-confirm-delete" disabled={remove.isPending} onClick={() => remove.mutate(del.id)}>
                {t('common.delete')}
              </Button>
            </>
          }
        />
      )}
    </section>
  )
}

function PluginDialog({ plugin, onClose, onSaved }: { plugin: Plugin | null; onClose: () => void; onSaved: () => void }) {
  const { t, err } = useI18n()
  const [name, setName] = useState(plugin?.name ?? '')
  const [description, setDescription] = useState(plugin?.description ?? '')
  const [transport, setTransport] = useState<PluginTransport>(plugin?.transport ?? 'http')
  const [url, setUrl] = useState(plugin?.url ?? '')
  const [rows, setRows] = useState<HeaderRow[]>(plugin ? toHeaderRows(plugin.headers) : [])
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim() || null, transport, url: url.trim(), headers: buildHeaders(rows) }
      return plugin ? api.updatePlugin(plugin.id, body) : api.createPlugin(body)
    },
    onSuccess: onSaved,
    onError: (e) => setError(err(e)),
  })
  const renamed = renamedWithoutValue(rows)
  const patchRow = (key: string, p: Partial<HeaderRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={plugin ? t('plugins.edit') : t('plugins.add')}
      className="max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" data-testid="plugin-save" disabled={save.isPending || !name.trim() || !url.trim() || renamed.length > 0} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />}
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="plugin-dialog">
        <div>
          <label htmlFor="pl-name" className={labelClass}>{t('plugins.name')}</label>
          <input id="pl-name" className={inputClass} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pl-desc" className={labelClass}>{t('plugins.description')}</label>
          <input id="pl-desc" className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <div>
            <label htmlFor="pl-tr" className={labelClass}>{t('plugins.transport')}</label>
            <select id="pl-tr" className={inputClass} value={transport} onChange={(e) => setTransport(e.target.value as PluginTransport)}>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </select>
          </div>
          <div>
            <label htmlFor="pl-url" className={labelClass}>{t('plugins.url')}</label>
            <input id="pl-url" className={inputClass} type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium">{t('plugins.headers')}</span>
            <Button size="sm" variant="ghost" data-testid="plugin-add-header" onClick={() => setRows((r) => [...r, newRow()])}>
              <Plus className="size-4" /> {t('plugins.addHeader')}
            </Button>
          </div>
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.key} data-testid="header-row" className="flex items-center gap-1.5">
                <input
                  aria-label={t('plugins.headerName')}
                  placeholder={t('plugins.headerName')}
                  name={`header-name-${r.key}`}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                  className={`${inputClass} w-2/5 font-mono`}
                  value={r.name}
                  onChange={(e) => patchRow(r.key, { name: e.target.value })}
                />
                <input
                  aria-label={t('plugins.headerValue')}
                  data-testid="header-value"
                  type={r.show ? 'text' : 'password'}
                  name={`header-value-${r.key}`}
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                  placeholder={r.masked !== null ? `${r.masked}  (${t('plugins.headerKept')})` : t('plugins.headerValue')}
                  className={`${inputClass} flex-1 font-mono`}
                  value={r.value}
                  onChange={(e) => patchRow(r.key, { value: e.target.value })}
                />
                <Button size="icon" variant="ghost" aria-label={r.show ? t('plugins.hideValue') : t('plugins.showValue')} onClick={() => patchRow(r.key, { show: !r.show })}>
                  {r.show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
                <Button size="icon" variant="ghost" aria-label={t('plugins.removeHeader')} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        {renamed.length > 0 && <p data-testid="header-rename-hint" className="text-sm text-muted">{t('plugins.headerRenamed')}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}
