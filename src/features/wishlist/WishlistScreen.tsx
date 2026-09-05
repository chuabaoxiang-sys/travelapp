import { lazy, Suspense, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Check, X, Pencil, Trash2, Plus, Circle, CheckCircle2, MapPin } from 'lucide-react'
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

// leaflet/react-leaflet源码近4MB，只有切到"地图"这个视图才用得到——懒加载，
// 跟ItineraryTab.tsx里MapView的懒加载是同一个道理
const WishlistMapView = lazy(() => import('./WishlistMapView').then((m) => ({ default: m.WishlistMapView })))

type ViewMode = 'list' | 'map'

export function WishlistScreen({
  currentMemberId,
  onClose,
  nearbySuggestions,
  onAddNearby,
}: {
  currentMemberId: string
  onClose: () => void
  // 只有从"行程"tab进来时才有——那里才知道"当前这一天"，才能算"附近"。
  // 从行程选择页（TripPicker）进来时不传，这个入口整块不出现
  nearbySuggestions?: WishlistPlace[]
  onAddNearby?: (place: WishlistPlace) => void
}) {
  const { t } = useTranslation()
  const places = useLiveQuery(() => listWishlistPlaces()) ?? []
  const usageMap = useLiveQuery(() => usageByWishlistEntry()) ?? new Map<string, WishlistUsage>()

  const [viewMode, setViewMode] = useState<ViewMode>('list')
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
        <span className="font-serif-sc text-[15px] font-semibold">{t('wishlist.title')}</span>
        <button onClick={onClose} className="text-muted" title={t('wishlist.close')}>
          <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
        </button>
      </div>

      <div className="px-5 pt-2.5 pb-1 flex-shrink-0">
        <div className="flex gap-1 bg-segment rounded-xl p-1 w-fit">
          {(['list', 'map'] as ViewMode[]).map((key) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] ${viewMode === key ? 'bg-ink text-paper' : 'text-muted'}`}
            >
              {t(`wishlist.viewModes.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'map' ? (
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<div className="px-5 pt-6 text-sm text-muted">{t('wishlist.mapLoading')}</div>}>
            <WishlistMapView places={places} />
          </Suspense>
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-3">
        {places.length === 0 && (
          <div className="text-[13px] text-muted py-8 text-center">
            {t('wishlist.empty')}
          </div>
        )}

        {/* 只有从"行程"tab带着"当前这一天"进来、且这一天附近确实有还没排进去的
            想去地点时才出现——从行程选择页进来（没有day context）不会有这个入口。
            "加入今天"之后这条会从 nearbySuggestions 里自动消失（父组件的
            suggestions 是活查询算出来的，加进行程即排除），不需要本地维护状态 */}
        {!!nearbySuggestions?.length && (
          <div className="mb-4">
            <div className="text-[10.5px] tracking-widest uppercase text-plan font-semibold mb-1.5 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" strokeWidth={2.2} />
              {t('wishlist.nearbyLabel', { count: nearbySuggestions.length })}
            </div>
            <div className="flex flex-col gap-1.5">
              {nearbySuggestions.map((s) => (
                <div key={s.id} className="flex items-center gap-2.5 bg-plan/5 border border-dashed border-plan/35 rounded-2xl pl-3.5 pr-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium truncate">{s.name}</div>
                    {s.notes && <div className="text-[10.5px] text-muted truncate mt-0.5">{s.notes}</div>}
                  </div>
                  <button
                    onClick={() => onAddNearby?.(s)}
                    className="w-6 h-6 rounded-full bg-plan text-card flex items-center justify-center flex-shrink-0"
                    title={t('wishlist.addToToday')}
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
            <div className="text-[10.5px] tracking-widest uppercase text-muted font-semibold mt-4 mb-1.5">{t('wishlist.allPlaces')}</div>
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
                      {p.visited ? t('wishlist.visited') : t('wishlist.notVisited')}
                    </button>
                  )}
                </div>

                {editingId === p.id && (
                  <div className="mt-2 pt-2 border-t border-dashed border-line">
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder={t('wishlist.notesPlaceholder')}
                      rows={2}
                      className="w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan"
                    />
                  </div>
                )}

                {editingId !== p.id && usage && usage.tripNames.length > 0 && (
                  <div className="text-[10.5px] text-plan mt-2 pt-2 border-t border-dashed border-line flex items-center gap-1.5">
                    <Check className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
                    {t('wishlist.usedInTrips', { trips: usage.tripNames.join('、') })}
                  </div>
                )}

                <div className="flex gap-2 mt-2.5">
                  {editingId === p.id ? (
                    <>
                      <button onClick={() => setEditingId(null)} className="text-muted px-2 py-1" title={t('wishlist.cancel')}>
                        <X className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                      <button onClick={() => saveEdit(p)} className="bg-plan text-card rounded-md px-2.5 py-1 ml-auto" title={t('wishlist.save')}>
                        <Check className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(p)} className="text-plan px-2 py-1 border border-dashed border-plan/50 rounded-md" title={t('wishlist.edit')}>
                        <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                      <button onClick={() => setPendingDelete(p)} className="text-negative px-2 py-1 border border-dashed border-negative/40 rounded-md" title={t('wishlist.delete')}>
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
      )}

      <button
        onClick={openAddModal}
        title={t('wishlist.add')}
        className="absolute bottom-5 right-5 w-[46px] h-[46px] rounded-full bg-plan text-card flex items-center justify-center transition-transform active:scale-95"
        style={{ boxShadow: '0 8px 18px color-mix(in srgb, var(--color-plan) 40%, transparent)' }}
      >
        <Plus className="w-6 h-6" strokeWidth={2.4} />
      </button>

      {pendingDelete && (
        <ConfirmDialog
          title={t('wishlist.deleteConfirmTitle', { name: pendingDelete.name })}
          message={t('wishlist.deleteConfirmMessage')}
          onConfirm={confirmRemove}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {addOpen && (
        <CenteredModal onClose={() => setAddOpen(false)}>
          <div className="font-serif-sc text-[15px] text-ink mb-3">{t('wishlist.addTitle')}</div>
          <LocationPicker value={addLocation} onChange={setAddLocation} />
          <textarea
            value={addNotes}
            onChange={(e) => setAddNotes(e.target.value)}
            placeholder={t('wishlist.notesPlaceholder')}
            rows={2}
            className="w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan mt-2"
          />
          <div className="flex gap-2 mt-4">
            <button onClick={() => setAddOpen(false)} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title={t('wishlist.cancel')}>
              <X className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <button onClick={confirmAdd} className="flex-1 rounded-xl bg-plan text-card py-2 flex items-center justify-center" title={t('wishlist.save')}>
              <Check className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </CenteredModal>
      )}
    </div>
  )
}
