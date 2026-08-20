import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, X, Pencil, Trash2, Plus, Circle, CheckCircle2 } from 'lucide-react'
import {
  listWishlistPlaces,
  createWishlistPlace,
  updateWishlistPlace,
  toggleWishlistVisited,
  deleteWishlistPlace,
  usageByWishlistEntry,
  type WishlistUsage,
} from '../../domain/wishlist'
import { LocationPicker, type LocationValue } from '../../components/LocationPicker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CenteredModal } from '../../components/CenteredModal'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { WishlistPlace } from '../../types'

export function WishlistScreen({
  currentMemberId,
  onClose,
}: {
  currentMemberId: string
  onClose: () => void
}) {
  const places = useLiveQuery(() => listWishlistPlaces()) ?? []
  const usageMap = useLiveQuery(() => usageByWishlistEntry()) ?? new Map<string, WishlistUsage>()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLocation, setEditLocation] = useState<LocationValue>({ name: '', lat: null, lng: null })
  const [editNotes, setEditNotes] = useState('')
  const [pendingDelete, setPendingDelete] = useState<WishlistPlace | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addLocation, setAddLocation] = useState<LocationValue>({ name: '', lat: null, lng: null })
  const [addNotes, setAddNotes] = useState('')

  // 三个嵌套弹层（pendingDelete 的 ConfirmDialog、addOpen 的 CenteredModal）打开时
  // 暂停这里自己的Escape监听，避免一键关掉两层
  useEscapeKey(!pendingDelete && !addOpen, onClose)

  function openAddModal() {
    setAddLocation({ name: '', lat: null, lng: null })
    setAddNotes('')
    setAddOpen(true)
  }

  async function confirmAdd() {
    if (!addLocation.name.trim()) return
    await createWishlistPlace({
      name: addLocation.name.trim(),
      lat: addLocation.lat,
      lng: addLocation.lng,
      notes: addNotes.trim() || null,
      createdBy: currentMemberId,
    })
    setAddOpen(false)
  }

  function startEdit(p: WishlistPlace) {
    setEditingId(p.id)
    setEditLocation({ name: p.name, lat: p.lat, lng: p.lng })
    setEditNotes(p.notes ?? '')
  }

  async function saveEdit(p: WishlistPlace) {
    if (!editLocation.name.trim()) return
    await updateWishlistPlace(p.id, {
      name: editLocation.name.trim(),
      lat: editLocation.lat,
      lng: editLocation.lng,
      notes: editNotes.trim() || null,
    })
    setEditingId(null)
  }

  async function confirmRemove() {
    if (!pendingDelete) return
    await deleteWishlistPlace(pendingDelete.id)
    if (editingId === pendingDelete.id) setEditingId(null)
    setPendingDelete(null)
  }

  return (
    <div className="absolute inset-0 z-30 bg-paper flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0 border-b border-line">
        <span className="font-serif-sc text-[15px] font-semibold">想去的地点</span>
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
        {places.length === 0 && (
          <div className="text-[13px] text-muted py-8 text-center">
            还没有收藏任何地点。刷到想去的餐厅/景点，点右上角"新增"先记下来，安排行程时随时能挑。
          </div>
        )}

        <div className="flex flex-col gap-2">
          {places.map((p) => {
            const usage = usageMap.get(p.id)
            return (
              <div key={p.id} className="bg-card border border-line rounded-2xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {editingId === p.id ? (
                      <LocationPicker value={editLocation} onChange={setEditLocation} />
                    ) : (
                      <div className="font-serif-sc text-[14px] font-semibold truncate">{p.name}</div>
                    )}
                    {editingId !== p.id && p.notes && (
                      <div className="text-[11px] text-muted mt-0.5 truncate">{p.notes}</div>
                    )}
                  </div>
                  {editingId !== p.id && (
                    <button
                      onClick={() => toggleWishlistVisited(p.id, !p.visited)}
                      className={`flex-shrink-0 rounded-full pl-2 pr-2.5 py-1 text-[10.5px] font-semibold flex items-center gap-1 border ${
                        p.visited
                          ? 'bg-positive/10 border-positive text-positive'
                          : 'border-dashed border-line bg-paper text-muted'
                      }`}
                    >
                      {p.visited ? (
                        <CheckCircle2 className="w-3 h-3" strokeWidth={2} />
                      ) : (
                        <Circle className="w-3 h-3" strokeWidth={2} />
                      )}
                      {p.visited ? '已去过' : '还没去'}
                    </button>
                  )}
                </div>

                {editingId === p.id && (
                  <div className="mt-2 pt-2 border-t border-dashed border-line">
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="备注（可选）"
                      rows={2}
                      className="w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan"
                    />
                  </div>
                )}

                {editingId !== p.id && usage && usage.tripNames.length > 0 && (
                  <div className="text-[10.5px] text-plan mt-2 pt-2 border-t border-dashed border-line flex items-center gap-1.5">
                    <Check className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
                    已排入行程 · {usage.tripNames.join('、')}
                  </div>
                )}

                <div className="flex gap-2 mt-2.5">
                  {editingId === p.id ? (
                    <>
                      <button onClick={() => setEditingId(null)} className="text-muted px-2 py-1" title="取消">
                        <X className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                      <button onClick={() => saveEdit(p)} className="bg-plan text-card rounded-md px-2.5 py-1 ml-auto" title="保存">
                        <Check className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(p)} className="text-plan px-2 py-1 border border-dashed border-plan/50 rounded-md" title="编辑">
                        <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                      <button onClick={() => setPendingDelete(p)} className="text-negative px-2 py-1 border border-dashed border-negative/40 rounded-md" title="删除">
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`删除「${pendingDelete.name}」？`}
          message="已经加进行程的行程项不受影响，只是这条不再出现在这份清单里，无法恢复。"
          onConfirm={confirmRemove}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {addOpen && (
        <CenteredModal onClose={() => setAddOpen(false)}>
          <div className="font-serif-sc text-[15px] text-ink mb-3">新增想去的地点</div>
          <LocationPicker value={addLocation} onChange={setAddLocation} />
          <textarea
            value={addNotes}
            onChange={(e) => setAddNotes(e.target.value)}
            placeholder="备注（可选）"
            rows={2}
            className="w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan mt-2"
          />
          <div className="flex gap-2 mt-4">
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
