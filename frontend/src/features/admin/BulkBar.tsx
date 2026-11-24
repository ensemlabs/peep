import { Check, UserCheck, UserX, Trash2 } from 'lucide-react'
import type { BulkAction } from '@/api/types'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Spinner } from '@/components/ui/Spinner'

export function BulkBar({ count, busy, onAction, onClear }: { count: number; busy: boolean; onAction: (a: BulkAction) => void; onClear: () => void }) {
  const { t } = useI18n()
  return (
    <div data-testid="bulk-bar" className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
      <span className="mr-auto text-sm font-medium">{t('admin.selected', { n: count })}</span>
      <Button size="sm" variant="primary" data-testid="bulk-approve" disabled={busy} onClick={() => onAction('approve')}>
        <Check className="size-4" /> {t('admin.approve')}
      </Button>
      <Button size="sm" data-testid="bulk-enable" disabled={busy} onClick={() => onAction('enable')}>
        <UserCheck className="size-4" /> {t('admin.enable')}
      </Button>
      <Button size="sm" data-testid="bulk-disable" disabled={busy} onClick={() => onAction('disable')}>
        <UserX className="size-4" /> {t('admin.disable')}
      </Button>
      <Button size="sm" variant="danger" data-testid="bulk-delete" disabled={busy} onClick={() => onAction('delete')}>
        <Trash2 className="size-4" /> {t('admin.delete')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>{t('admin.clear')}</Button>
    </div>
  )
}

export function BulkConfirm({ action, count, busy, onClose, onConfirm }: { action: 'disable' | 'delete'; count: number; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t } = useI18n()
  const del = action === 'delete'
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(del ? 'admin.bulk.confirmDelete' : 'admin.bulk.confirmDisable', { n: count })}
      description={del ? t('admin.bulk.deleteBody') : undefined}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant={del ? 'danger' : 'primary'} data-testid="confirm-btn" disabled={busy} onClick={onConfirm}>
            {busy && <Spinner />} {t(del ? 'common.delete' : 'admin.disable')}
          </Button>
        </>
      }
    />
  )
}
