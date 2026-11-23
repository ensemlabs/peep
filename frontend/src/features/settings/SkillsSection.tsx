import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Trash2, Upload } from 'lucide-react'
import { api } from '@/api/client'
import type { Skill } from '@/api/types'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Spinner } from '@/components/ui/Spinner'
import { Markdown } from '@/features/chat/parts/Markdown'
import { useToasts } from '@/components/Toaster'
import { Switch } from './Switch'
import { skillUploadError, stripFrontmatter, type SkillUploadError } from './skills'

const KEY = ['skills'] as const

export function SkillsSection() {
  const { t, err } = useI18n()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: KEY, queryFn: api.skills })
  const fileRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [failed, setFailed] = useState<{ file: File; error: SkillUploadError } | null>(null)
  const [view, setView] = useState<Skill | null>(null)
  const [del, setDel] = useState<Skill | null>(null)
  const toast = useToasts((s) => s.push)

  const upload = useMutation({
    mutationFn: (v: { file: File; replace?: boolean }) => api.uploadSkill(v.file, v.replace),
    onSuccess: () => {
      setFailed(null)
      qc.invalidateQueries({ queryKey: KEY })
    },
    onError: (e, v) => setFailed({ file: v.file, error: skillUploadError(e, t) }),
  })
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => api.setSkillEnabled(v.id, v.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast(err(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSkill(id),
    onSuccess: () => {
      setDel(null)
      qc.invalidateQueries({ queryKey: KEY })
    },
    onError: (e) => {
      setDel(null)
      toast(err(e))
    },
  })

  const pick = (files: FileList | File[] | null) => {
    const f = files && Array.from(files)[0]
    if (f) upload.mutate({ file: f })
  }
  const items = list.data?.items ?? []

  return (
    <section data-testid="skills-section">
      <h2 className="text-sm font-semibold">{t('skills.title')}</h2>
      <p className="mb-3 mt-0.5 text-sm text-muted">{t('skills.subtitle')}</p>

      <div
        data-testid="skills-dropzone"
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          pick(e.dataTransfer.files)
        }}
        className={cn(
          'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors',
          drag ? 'border-fg/50 bg-hover' : 'border-line bg-surface',
        )}
      >
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".md,.zip,text/markdown,application/zip"
          data-testid="skills-upload"
          onChange={(e) => {
            pick(e.target.files)
            e.target.value = ''
          }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-2 text-muted hover:text-fg">
          {upload.isPending ? <Spinner /> : <Upload className="size-4" />}
          {upload.isPending ? t('skills.uploading') : t('skills.drop')}
        </button>
      </div>

      {failed && (
        <div role="alert" data-testid="skills-error" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-danger">
          <span>{failed.error.message}</span>
          {failed.error.canReplace && (
            <Button size="sm" data-testid="skills-replace" onClick={() => upload.mutate({ file: failed.file, replace: true })}>
              {t('skills.replace')}
            </Button>
          )}
        </div>
      )}
      {list.isError && <p role="alert" className="mt-3 text-sm text-danger">{err(list.error)}</p>}

      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {items.length === 0 && !list.isLoading && <li className="px-4 py-6 text-center text-sm text-muted">{t('skills.empty')}</li>}
        {items.map((s) => (
          <li key={s.id} data-testid="skill-row" data-name={s.name} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{s.name}</div>
              <div className="line-clamp-2 text-xs text-muted">{s.description}</div>
              <div className="mt-0.5 text-xs text-muted">{t('skills.files', { n: s.file_count })}</div>
            </div>
            <Switch
              checked={s.enabled}
              label={t('skills.toggle', { name: s.name })}
              testId="skill-toggle"
              onChange={(enabled) => toggle.mutate({ id: s.id, enabled })}
            />
            <Button size="icon" variant="ghost" aria-label={`${t('skills.view')}: ${s.name}`} data-testid="skill-view" onClick={() => setView(s)}>
              <Eye className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label={`${t('skills.delete')}: ${s.name}`} data-testid="skill-delete" onClick={() => setDel(s)}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>

      {view && <SkillViewDialog skill={view} onClose={() => setView(null)} />}
      {del && (
        <Dialog
          open
          onOpenChange={(o) => !o && setDel(null)}
          title={t('skills.deleteTitle', { name: del.name })}
          description={t('skills.deleteBody')}
          footer={
            <>
              <Button onClick={() => setDel(null)}>{t('common.cancel')}</Button>
              <Button variant="danger" data-testid="skill-confirm-delete" disabled={remove.isPending} onClick={() => remove.mutate(del.id)}>
                {t('common.delete')}
              </Button>
            </>
          }
        />
      )}
    </section>
  )
}

function SkillViewDialog({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const { t, err } = useI18n()
  const detail = useQuery({ queryKey: ['skill', skill.id], queryFn: () => api.skill(skill.id) })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={skill.name} className="max-w-2xl">
      <div data-testid="skill-view-dialog">
        {detail.isLoading && <Spinner className="text-muted" label={t('common.loading')} />}
        {detail.isError && <p className="text-sm text-danger">{err(detail.error)}</p>}
        {detail.data && (
          <>
            <Markdown text={stripFrontmatter(detail.data.skill_md)} />
            {detail.data.files.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{t('skills.filesList')}</h4>
                <ul className="font-mono text-xs text-muted">
                  {detail.data.files.map((f) => (
                    <li key={f.path} className="truncate">{f.path}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
