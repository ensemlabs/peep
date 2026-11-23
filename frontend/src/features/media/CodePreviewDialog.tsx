import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Spinner } from '@/components/ui/Spinner'
import { CodeBlock } from '../chat/parts/CodeBlock'
import { languageForFile } from '@/lib/files'
import { useT } from '@/i18n'
import type { FileMeta } from '@/api/types'

export default function CodePreviewDialog({ file, open, onOpenChange }: { file: FileMeta; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ok'; text: string }>({ status: 'loading', text: '' })

  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    setState({ status: 'loading', text: '' })
    fetch(file.url, { credentials: 'same-origin', signal: ctrl.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => setState({ status: 'ok', text }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ status: 'error', text: '' })
      })
    return () => ctrl.abort()
  }, [file.url, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={file.filename} className="max-w-3xl">
      <div data-testid="code-preview">
        {state.status === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> {t('media.previewLoading')}</p>
        )}
        {state.status === 'error' && <p className="text-sm text-danger">{t('media.previewFailed')}</p>}
        {state.status === 'ok' && <CodeBlock code={state.text} language={languageForFile(file.filename)} className="my-0" />}
      </div>
    </Dialog>
  )
}
