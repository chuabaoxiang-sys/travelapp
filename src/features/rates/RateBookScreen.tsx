import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, X, Pencil, Archive, ArchiveRestore, Plus } from 'lucide-react'
import {
  getAllRateBookEntries,
  updateRateBookEntry,
  archiveRateBookEntry,
  unarchiveRateBookEntry,
  createRateBookEntry,
  usedForeignAmountByEntry,
  deriveRateFromExchangeAmounts,
} from '../../domain/rates'
import { ExchangeAmountFields } from './ExchangeAmountFields'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CenteredModal } from '../../components/CenteredModal'
import { useEscapeKey } from '../../hooks/useEscapeKey'
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
  const usedByEntry = useLiveQuery(() => usedForeignAmountByEntry(trip.id), [trip.id]) ?? new Map<string, number>()

  const byCurrency = new Map<string, RateBookEntry[]>()
  for (const e of active) {
    if (!byCurrency.has(e.foreignCurrency)) byCurrency.set(e.foreignCurrency, [])
    byCurrency.get(e.foreignCurrency)!.push(e)
  }

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [editExchangeHome, setEditExchangeHome] = useState('')
  const [editExchangeForeign, setEditExchangeForeign] = useState('')
  const [saveAsNewFor, setSaveAsNewFor] = useState<RateBookEntry | null>(null)
  const [newLabelValue, setNewLabelValue] = useState('')
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addCurrency, setAddCurrency] = useState('')
  const [addLabel, setAddLabel] = useState('')
  const [addRate, setAddRate] = useState('')
  const [addExchangeHome, setAddExchangeHome] = useState('')
  const [addExchangeForeign, setAddExchangeForeign] = useState('')

  // 三个嵌套弹层（confirmArchiveId 的 ConfirmDialog、saveAsNewFor/addOpen 的
  // CenteredModal）打开时暂停这里自己的Escape监听，避免一键关掉两层
  useEscapeKey(!confirmArchiveId && !saveAsNewFor && !addOpen, onClose)

  function openAddModal() {
    setAddCurrency('')
    setAddLabel('')
    setAddRate('')
    setAddExchangeHome('')
    setAddExchangeForeign('')
    setAddOpen(true)
  }

  function onAddExchangeChange(home: string, foreign: string) {
    setAddExchangeHome(home)
    setAddExchangeForeign(foreign)
    const derived = deriveRateFromExchangeAmounts(home, foreign)
    // 7位小数——像日元这种面额大的币种，汇率小数点后差一点点，摊到大金额上
    // 就是实打实的钱，4位不够精确
    if (derived != null) setAddRate(derived.toFixed(7))
  }

  async function confirmAdd() {
    const r = parseFloat(addRate)
    if (!addCurrency.trim() || !addLabel.trim() || !(r > 0)) return
    const home = parseFloat(addExchangeHome)
    const foreign = parseFloat(addExchangeForeign)
    await createRateBookEntry({
      tripId: trip.id,
      foreignCurrency: addCurrency.trim().toUpperCase(),
      label: addLabel.trim(),
      rate: r,
      source: 'manual',
      createdBy: currentMemberId,
      exchangedHomeAmount: home > 0 ? home : null,
      exchangedForeignAmount: foreign > 0 ? foreign : null,
    })
    setAddOpen(false)
  }

  function startEdit(e: RateBookEntry) {
    setEditingId(e.id)
    setEditValue(String(e.rate))
    setEditLabel(e.label)
    setEditExchangeHome(e.exchangedHomeAmount != null ? String(e.exchangedHomeAmount) : '')
    setEditExchangeForeign(e.exchangedForeignAmount != null ? String(e.exchangedForeignAmount) : '')
  }

  function onEditExchangeChange(home: string, foreign: string) {
    setEditExchangeHome(home)
    setEditExchangeForeign(foreign)
    const derived = deriveRateFromExchangeAmounts(home, foreign)
    if (derived != null) setEditValue(derived.toFixed(7))
  }

  async function saveEdit(e: RateBookEntry) {
    const r = parseFloat(editValue)
    if (!(r > 0) || !editLabel.trim()) return
    const home = parseFloat(editExchangeHome)
    const foreign = parseFloat(editExchangeForeign)
    await updateRateBookEntry(e.id, {
      rate: r,
      label: editLabel.trim(),
      exchangedHomeAmount: home > 0 ? home : null,
      exchangedForeignAmount: foreign > 0 ? foreign : null,
    })
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
    const home = parseFloat(editExchangeHome)
    const foreign = parseFloat(editExchangeForeign)
    await createRateBookEntry({
      tripId: trip.id,
      foreignCurrency: saveAsNewFor.foreignCurrency,
      label: newLabelValue.trim(),
      rate: r,
      source: 'manual',
      createdBy: currentMemberId,
      exchangedHomeAmount: home > 0 ? home : null,
      exchangedForeignAmount: foreign > 0 ? foreign : null,
    })
    setSaveAsNewFor(null)
    setEditingId(null)
  }

  return (
    <div className="absolute inset-0 z-30 bg-paper flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0 border-b border-line">
        <span className="font-serif-sc text-[15px] font-semibold">汇率簿</span>
        <div className="flex items-center gap-3.5">
          <button onClick={openAddModal} className="flex items-center gap-1 text-plan text-[12.5px] font-semibold">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
            新增
          </button>
          <button onClick={onClose} className="text-plan" title="完成">
            <Check className="w-[17px] h-[17px]" strokeWidth={2} />
          </button>
        </div>
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
                        {editingId === e.id ? (
                          <input
                            value={editLabel}
                            onChange={(ev) => setEditLabel(ev.target.value)}
                            className="w-full rounded-lg border border-plan bg-paper px-2 py-1 text-[14px] font-serif-sc font-semibold outline-none"
                          />
                        ) : (
                          <div className="font-serif-sc text-[14px] font-semibold truncate">{e.label}</div>
                        )}
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
                    {editingId === e.id && (
                      <div className="mt-2 pt-2 border-t border-dashed border-line">
                        <ExchangeAmountFields
                          homeCurrency={trip.homeCurrency}
                          foreignCurrency={e.foreignCurrency}
                          homeAmount={editExchangeHome}
                          foreignAmount={editExchangeForeign}
                          onChangeHomeAmount={(v) => onEditExchangeChange(v, editExchangeForeign)}
                          onChangeForeignAmount={(v) => onEditExchangeChange(editExchangeHome, v)}
                        />
                      </div>
                    )}
                    {editingId !== e.id && e.exchangedForeignAmount != null && (() => {
                      const used = usedByEntry.get(e.id) ?? 0
                      const total = e.exchangedForeignAmount as number
                      const over = used > total
                      const pct = total > 0 ? (used / total) * 100 : 0
                      return (
                        <>
                          <div className="text-[11px] text-positive mt-2 pt-2 border-t border-dashed border-line flex items-center gap-1.5">
                            <Check className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
                            已换：{e.exchangedHomeAmount} {trip.homeCurrency} → {e.exchangedForeignAmount.toLocaleString()} {e.foreignCurrency}
                          </div>
                          <div className={`flex items-baseline justify-between text-[10.5px] mt-1.5 ${over ? 'text-negative' : 'text-muted'}`}>
                            <span>
                              已用 <b className={over ? 'text-negative font-semibold' : 'text-ink font-semibold'}>{used.toLocaleString()}</b> / 已换 {total.toLocaleString()} {e.foreignCurrency}
                            </span>
                            <span>{over ? `超出 ${(used - total).toLocaleString()}` : `还剩 ${(total - used).toLocaleString()}`}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-line overflow-hidden mt-1">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(100, pct)}%`, background: over ? 'var(--color-negative)' : 'var(--color-positive)' }}
                            />
                          </div>
                        </>
                      )
                    })()}
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
        <CenteredModal onClose={() => setSaveAsNewFor(null)}>
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
        </CenteredModal>
      )}

      {addOpen && (
        <CenteredModal onClose={() => setAddOpen(false)}>
          <div className="font-serif-sc text-[15px] text-ink mb-3">新增汇率</div>
          <div className="flex gap-2 mb-2.5">
            <div className="flex-1">
              <div className="text-[10px] tracking-widest uppercase text-muted mb-1">币种</div>
              <input
                autoFocus
                value={addCurrency}
                onChange={(e) => setAddCurrency(e.target.value.toUpperCase())}
                placeholder="例如 JPY"
                className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm tabular outline-none focus:border-plan"
              />
            </div>
            <div className="flex-1">
              <div className="text-[10px] tracking-widest uppercase text-muted mb-1">汇率</div>
              <input
                value={addRate}
                onChange={(e) => setAddRate(e.target.value)}
                inputMode="decimal"
                placeholder="0.0000"
                className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm tabular outline-none focus:border-plan"
              />
            </div>
          </div>
          <div className="mb-2.5">
            <div className="text-[10px] tracking-widest uppercase text-muted mb-1">标签</div>
            <input
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              placeholder="例如「机场换的」"
              className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan"
            />
          </div>
          <ExchangeAmountFields
            homeCurrency={trip.homeCurrency}
            foreignCurrency={addCurrency || '外币'}
            homeAmount={addExchangeHome}
            foreignAmount={addExchangeForeign}
            onChangeHomeAmount={(v) => onAddExchangeChange(v, addExchangeForeign)}
            onChangeForeignAmount={(v) => onAddExchangeChange(addExchangeHome, v)}
          />
          <div className="flex gap-2 mt-2">
            <button onClick={() => setAddOpen(false)} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title="取消">
              <X className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <button onClick={confirmAdd} className="flex-1 rounded-xl bg-plan text-card py-2 flex items-center justify-center" title="保存">
              <Check className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </CenteredModal>
      )}
    </div>
  )
}
