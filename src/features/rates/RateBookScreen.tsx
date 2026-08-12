import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, X, Pencil, Archive, ArchiveRestore } from 'lucide-react'
import { getAllRateBookEntries, updateRateBookEntry, archiveRateBookEntry, unarchiveRateBookEntry, createRateBookEntry } from '../../domain/rates'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { Trip, RateBookEntry } from '../../types'

const SOURCE_LABEL: Record<RateBookEntry['source'], string> = {
  manual: '手动输入',
  api_accepted: 'API参考值',
  api_edited: 'API参考后调整',
}

export function RateBookScreen({
  trip,
  currentMemberId,
  onClose,
}: {
  trip: Trip
  currentMemberId: string
  onClose: () => void
}) {
  const entries = useLiveQuery(() => getAllRateBookEntries(trip.id), [trip.id]) ?? []
  const active = entries.filter((e) => !e.archived)
  const archived = entries.filter((e) => e.archived)

  const byCurrency = new Map<string, RateBookEntry[]>()
  for (const e of active) {
    if (!byCurrency.has(e.foreignCurrency)) byCurrency.set(e.foreignCurrency, [])
    byCurrency.get(e.foreignCurrency)!.push(e)
  }

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saveAsNewFor, setSaveAsNewFor] = useState<RateBookEntry | null>(null)
  const [newLabelValue, setNewLabelValue] = useState('')
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  function startEdit(e: RateBookEntry) {
    setEditingId(e.id)
    setEditValue(String(e.rate))
  }

  async function saveEdit(e: RateBookEntry) {
    const r = parseFloat(editValue)
    if (r > 0) await updateRateBookEntry(e.id, r)
    setEditingId(null)
  }

  function startSaveAsNew(e: RateBookEntry) {
    setSaveAsNewFor(e)
    setNewLabelValue(`${e.label}(新)`)
  }

  async function confirmSaveAsNew() {
    if (!saveAsNewFor) return
    const r = parseFloat(editValue)
    if (!r || !newLabelValue.trim()) return
    await createRateBookEntry({
      tripId: trip.id,
      foreignCurrency: saveAsNewFor.foreignCurrency,
      label: newLabelValue.trim(),
      rate: r,
      source: 'manual',
      createdBy: currentMemberId,
    })
    setSaveAsNewFor(null)
    setEditingId(null)
  }

  return (
    <div className="absolute inset-0 z-30 bg-paper flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0 border-b border-line">
        <span className="font-serif-sc text-[15px] font-semibold">汇率簿</span>
        <button onClick={onClose} className="text-plan" title="完成">
          <Check className="w-[17px] h-[17px]" strokeWidth={2} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-3">
        {byCurrency.size === 0 && (
          <div className="text-[13px] text-muted py-8 text-center">
            这趟行程还没有保存过任何汇率。记外币账时，点"＋新汇率"输入一次，之后就会出现在这里。
          </div>
        )}

        {[...byCurrency.entries()].map(([currency, list]) => (
          <div key={currency} className="mb-5">
            <div className="text-[10.5px] tracking-widest uppercase text-muted mb-2">
              {currency} → {trip.homeCurrency}
            </div>
            <div className="flex flex-col gap-2">
              {list
                .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
                .map((e) => (
                  <div key={e.id} className="bg-card border border-line rounded-2xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-serif-sc text-[14px] font-semibold truncate">{e.label}</div>
                        <div className="text-[11px] text-muted mt-0.5">
                          {SOURCE_LABEL[e.source]} · 最近用于 {new Date(e.lastUsedAt).toLocaleDateString('zh-CN')}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {editingId === e.id ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(ev) => setEditValue(ev.target.value)}
                            inputMode="decimal"
                            className="w-24 rounded-lg border border-plan bg-paper px-2 py-1 text-right text-[15px] font-serif-sc tabular outline-none"
                          />
                        ) : (
                          <div className="font-serif-sc text-[16px] tabular">{e.rate}</div>
                        )}
                        <div className="text-[10px] text-muted">用过 {e.useCount} 次</div>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2.5">
                      {editingId === e.id ? (
                        <>
                          <button onClick={() => setEditingId(null)} className="text-muted px-2 py-1" title="取消">
                            <X className="w-3.5 h-3.5" strokeWidth={1.8} />
                          </button>
                          <button onClick={() => startSaveAsNew(e)} className="text-[11px] text-plan px-2 py-1">另存为新标签</button>
                          <button onClick={() => saveEdit(e)} className="bg-plan text-card rounded-md px-2.5 py-1 ml-auto" title="保存">
                            <Check className="w-3.5 h-3.5" strokeWidth={2} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(e)} className="text-plan px-2 py-1 border border-dashed border-plan/50 rounded-md" title="编辑">
                            <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
                          </button>
                          <button onClick={() => setConfirmArchiveId(e.id)} className="text-muted px-2 py-1 border border-dashed border-line rounded-md" title="归档">
                            <Archive className="w-3.5 h-3.5" strokeWidth={1.8} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}

        {archived.length > 0 && (
          <div className="mt-2">
            <button onClick={() => setShowArchived((v) => !v)} className="text-[11.5px] text-muted">
              {showArchived ? '收起已归档' : `查看已归档的标签（${archived.length}）`}
            </button>
            {showArchived && (
              <div className="flex flex-col gap-2 mt-2">
                {archived.map((e) => (
                  <div key={e.id} className="bg-card border border-line rounded-2xl p-3 opacity-60 flex items-center justify-between">
                    <div>
                      <div className="text-[13px] font-medium">{e.label} · {e.foreignCurrency}</div>
                      <div className="text-[11px] text-muted">{e.rate}</div>
                    </div>
                    <button onClick={() => unarchiveRateBookEntry(e.id)} className="text-plan" title="恢复">
                      <ArchiveRestore className="w-[15px] h-[15px]" strokeWidth={1.8} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] text-muted mt-4 pb-6">
          编辑汇率只影响之后新记的账，不会改动过去已保存的记录金额；归档不会删除历史数据。
        </div>
      </div>

      {confirmArchiveId && (
        <ConfirmDialog
          title="归档这个汇率标签？"
          message="归档后不会再出现在记账的快捷选项里，但过去用它记的账不受影响，随时可以恢复。"
          confirmLabel="归档"
          danger={false}
          onConfirm={() => { archiveRateBookEntry(confirmArchiveId); setConfirmArchiveId(null) }}
          onCancel={() => setConfirmArchiveId(null)}
        />
      )}

      {saveAsNewFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={() => setSaveAsNewFor(null)}>
          <div className="absolute inset-0 bg-ink/45" />
          <div onClick={(e) => e.stopPropagation()} className="relative bg-card rounded-2xl p-5 w-full max-w-[300px] shadow-2xl">
            <div className="font-serif-sc text-[15px] text-ink mb-3">另存为新标签</div>
            <input
              autoFocus
              value={newLabelValue}
              onChange={(e) => setNewLabelValue(e.target.value)}
              placeholder="新标签名称"
              className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-plan"
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setSaveAsNewFor(null)} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title="取消">
                <X className="w-4 h-4" strokeWidth={1.8} />
              </button>
              <button onClick={confirmSaveAsNew} className="flex-1 rounded-xl bg-plan text-card py-2 flex items-center justify-center" title="保存">
                <Check className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
