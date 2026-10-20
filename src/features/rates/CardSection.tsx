import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Check, X, Pencil, Archive, ArchiveRestore, Trash2, Plus, CreditCard } from 'lucide-react'
import { db } from '../../db/dexie'
import {
  getPaymentCards,
  createPaymentCard,
  renamePaymentCard,
  archivePaymentCard,
  unarchivePaymentCard,
  deletePaymentCard,
  cardUsageForTrip,
  formatCardRate,
  type CardTripUsage,
} from '../../domain/paymentCards'
import { ConfirmDialog } from '../../components/ConfirmDialog'

// 汇率簿里的「卡 · 所有旅行通用」那一段（2026-10-20 刷卡记账）。卡按团队存，
// 跟这趟旅行无关，所以增改删都在这里；"这趟刷了几笔"只是给这趟的参考
export function CardSection({
  tripId,
  currentMemberId,
  onDialogOpenChange,
}: {
  tripId: string
  currentMemberId: string
  // 确认弹窗开着时，汇率簿自己的 Escape 要先让一让（跟汇率那几个弹层一样）
  onDialogOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const cards = useLiveQuery(() => getPaymentCards()) ?? []
  const tripUsage = useLiveQuery(() => cardUsageForTrip(tripId), [tripId]) ?? new Map<string, CardTripUsage>()
  // 能不能硬删看的是"所有行程、连已删除的开销在内"有没有挂着这张卡——
  // 跟数据库那道外键的判断一致（见 domain/paymentCards.ts 的 cardExpenseCount）
  const usedCardIds = useLiveQuery(async () => {
    const rows = await db.expenses.filter((e) => !!e.paymentCardId).toArray()
    return new Set(rows.map((e) => e.paymentCardId as string))
  }) ?? new Set<string>()

  const active = cards.filter((c) => !c.archivedAt)
  const archived = cards.filter((c) => c.archivedAt)

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  function openConfirm(kind: 'archive' | 'delete', id: string) {
    onDialogOpenChange(true)
    if (kind === 'archive') setConfirmArchiveId(id)
    else setConfirmDeleteId(id)
  }
  function closeConfirm() {
    setConfirmArchiveId(null)
    setConfirmDeleteId(null)
    onDialogOpenChange(false)
  }

  async function confirmAdd() {
    if (!newName.trim()) return
    await createPaymentCard(newName, currentMemberId)
    setNewName('')
    setAdding(false)
  }

  async function saveRename(id: string) {
    if (!editName.trim()) return
    await renamePaymentCard(id, editName)
    setEditingId(null)
  }

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10.5px] tracking-widest uppercase text-muted">{t('card.sectionTitle')}</div>
        <button onClick={() => setAdding((v) => !v)} className="text-plan p-1" title={t('card.add')}>
          <Plus className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>

      {adding && (
        <div className="flex items-center gap-1.5 mb-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmAdd() } }}
            placeholder={t('card.namePlaceholder')}
            className="flex-1 min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan"
          />
          <button onClick={() => setAdding(false)} className="text-muted px-1.5 py-1" title={t('rateBook.cancel')}>
            <X className="w-4 h-4" strokeWidth={1.8} />
          </button>
          <button onClick={confirmAdd} className="bg-plan text-card rounded-md px-2.5 py-1.5" title={t('rateBook.save')}>
            <Check className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {active.length === 0 && !adding && (
        <div className="text-[11.5px] text-muted bg-card border border-dashed border-line rounded-2xl px-3 py-2.5">
          {t('card.empty')}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {active.map((c) => {
          const u = tripUsage.get(c.id)
          const used = usedCardIds.has(c.id)
          return (
            <div key={c.id} className="bg-card border border-line rounded-2xl p-3 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-segment text-soft flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-3.5 h-3.5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                {editingId === c.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRename(c.id) } }}
                    className="w-full rounded-lg border border-plan bg-paper px-2 py-1 text-[14px] font-serif-sc font-semibold outline-none"
                  />
                ) : (
                  <div className="font-serif-sc text-[14px] font-semibold truncate">{c.name}</div>
                )}
                <div className="text-[11px] text-muted mt-0.5 tabular">
                  {u
                    ? u.averageRate != null
                      ? t('card.tripUsageWithAverage', { count: u.count, rate: formatCardRate(u.averageRate) })
                      : t('card.tripUsage', { count: u.count })
                    : t('card.tripUnused')}
                </div>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                {editingId === c.id ? (
                  <>
                    <button onClick={() => setEditingId(null)} className="text-muted px-2 py-1" title={t('rateBook.cancel')}>
                      <X className="w-3.5 h-3.5" strokeWidth={1.8} />
                    </button>
                    <button onClick={() => saveRename(c.id)} className="bg-plan text-card rounded-md px-2.5 py-1" title={t('rateBook.save')}>
                      <Check className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setEditingId(c.id); setEditName(c.name) }}
                      className="text-plan px-2 py-1 border border-dashed border-plan/50 rounded-md"
                      title={t('card.rename')}
                    >
                      <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
                    </button>
                    {used ? (
                      <button onClick={() => openConfirm('archive', c.id)} className="text-muted px-2 py-1 border border-dashed border-line rounded-md" title={t('card.archive')}>
                        <Archive className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                    ) : (
                      <button onClick={() => openConfirm('delete', c.id)} className="text-negative px-2 py-1 border border-dashed border-negative/40 rounded-md" title={t('card.delete')}>
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {archived.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowArchived((v) => !v)} className="text-[11.5px] text-muted">
            {showArchived ? t('card.collapseArchived') : t('card.viewArchived', { count: archived.length })}
          </button>
          {showArchived && (
            <div className="flex flex-col gap-2 mt-2">
              {archived.map((c) => (
                <div key={c.id} className="bg-card border border-line rounded-2xl p-3 opacity-60 flex items-center justify-between">
                  <div className="text-[13px] font-medium">{c.name}</div>
                  <button onClick={() => unarchivePaymentCard(c.id)} className="text-plan" title={t('card.restore')}>
                    <ArchiveRestore className="w-[15px] h-[15px]" strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmArchiveId && (
        <ConfirmDialog
          title={t('card.archiveConfirmTitle')}
          message={t('card.archiveConfirmMessage')}
          confirmLabel={t('card.archive')}
          danger={false}
          onConfirm={() => { archivePaymentCard(confirmArchiveId); closeConfirm() }}
          onCancel={closeConfirm}
        />
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title={t('card.deleteConfirmTitle')}
          message={t('card.deleteConfirmMessage')}
          confirmLabel={t('card.delete')}
          onConfirm={() => { deletePaymentCard(confirmDeleteId).catch(() => archivePaymentCard(confirmDeleteId)); closeConfirm() }}
          onCancel={closeConfirm}
        />
      )}
    </div>
  )
}
