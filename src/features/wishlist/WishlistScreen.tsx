import { lazy, Suspense, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Check, X, Pencil, Trash2, Plus, Circle, CheckCircle2, MapPin, ImageOff } from 'lucide-react'
import {
  listWishlistPlaces,
  createWishlistPlace,
  updateWishlistPlace,
  toggleWishlistVisited,
  deleteWishlistPlace,
  usageByWishlistEntry,
  addWishlistPlaceLink,
  deleteWishlistPlaceLink,
  linksByWishlistPlace,
  type WishlistUsage,
} from '../../domain/wishlist'
import { LocationPicker, type LocationValue } from '../../components/LocationPicker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CenteredModal } from '../../components/CenteredModal'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { WishlistPlace, WishlistPlaceLink, WishlistPlaceLinkPlatform } from '../../types'

// 平台角标用纯色圆点+一个字母/符号，不复刻各平台真实logo图形（避免商标问题），
// 颜色取每个平台的品牌色，够用来一眼分辨"这条链接是哪个平台的"
const PLATFORM_BADGE: Record<WishlistPlaceLinkPlatform, { color: string; label: string }> = {
  youtube: { color: '#E4342A', label: '▶' },
  facebook: { color: '#1877F2', label: 'f' },
  bilibili: { color: '#FB7299', label: 'B' },
  xiaohongshu: { color: '#FE2442', label: '红' },
  other: { color: 'var(--color-muted)', label: '·' },
}

const PLATFORM_LABEL_KEY: Record<WishlistPlaceLinkPlatform, string> = {
  youtube: 'wishlist.linkPlatformYoutube',
  facebook: 'wishlist.linkPlatformFacebook',
  bilibili: 'wishlist.linkPlatformBilibili',
  xiaohongshu: 'wishlist.linkPlatformXiaohongshu',
  other: 'wishlist.linkPlatformOther',
}

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
  const linksMap = useLiveQuery(() => linksByWishlistPlace()) ?? new Map<string, WishlistPlaceLink[]>()

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLocation, setEditLocation] = useState<LocationValue>({ name: '', lat: null, lng: null })
  const [editNotes, setEditNotes] = useState('')
  const [pendingDelete, setPendingDelete] = useState<WishlistPlace | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addLocation, setAddLocation] = useState<LocationValue>({ name: '', lat: null, lng: null })
  const [addNotes, setAddNotes] = useState('')
  const [addLinkUrl, setAddLinkUrl] = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [linkModalPlaceId, setLinkModalPlaceId] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkSubmitting, setLinkSubmitting] = useState(false)

  // 四个嵌套弹层（pendingDelete 的 ConfirmDialog、addOpen/linkModalPlaceId 的
  // CenteredModal）打开时暂停这里自己的Escape监听，避免一键关掉两层
  useEscapeKey(!pendingDelete && !addOpen && !linkModalPlaceId, onClose)

  function openLinkModal(placeId: string) {
    setLinkUrl('')
    setLinkModalPlaceId(placeId)
  }

  async function confirmAddLink() {
    if (!linkModalPlaceId || !linkUrl.trim()) return
    setLinkSubmitting(true)
    try {
      await addWishlistPlaceLink(linkModalPlaceId, linkUrl.trim(), currentMemberId)
      setLinkModalPlaceId(null)
    } finally {
      setLinkSubmitting(false)
    }
  }

  function openAddModal() {
    setAddLocation({ name: '', lat: null, lng: null })
    setAddNotes('')
    setAddLinkUrl('')
    setAddOpen(true)
  }

  // 参考链接是可选的——不填就跟以前一样，只存地点本身。填了的话，等地点
  // 存好拿到真正的id之后，接着走addWishlistPlaceLink同一套抓取逻辑，不用
  // 另外写一遍
  async function confirmAdd() {
    if (!addLocation.name.trim()) return
    setAddSubmitting(true)
    try {
      const place = await createWishlistPlace({
        name: addLocation.name.trim(),
        lat: addLocation.lat,
        lng: addLocation.lng,
        notes: addNotes.trim() || null,
        createdBy: currentMemberId,
      })
      if (addLinkUrl.trim()) {
        await addWishlistPlaceLink(place.id, addLinkUrl.trim(), currentMemberId)
      }
      setAddOpen(false)
    } finally {
      setAddSubmitting(false)
    }
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
        <Suspense fallback={<div className="px-5 pt-6 text-sm text-muted">{t('wishlist.mapLoading')}</div>}>
          <WishlistMapView places={places} />
        </Suspense>
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

                {/* 参考链接——横向大卡片轮播，图片区域够大能看清画面内容（比72×72
                    小图标方案明显更有分量）。抓不到缩略图时不缩小卡片、不报错，
                    图片区域换成平台色块+ImageOff图标，标题换成"预览不可用"，
                    点击照样跳转原链接——这是故意的优雅降级，不是bug。
                    一条链接都没有时，容器不能带overflow-x-auto——真机上验证过，
                    一个不需要横向滚动的overflow-x-auto区域（哪怕本身没有可滚动的
                    内容）仍然会被手机浏览器当成"这里归我管"，手指落在这块区域上
                    竖向滑动会卡一下、传不到外层列表，同时容器还是撑满卡片宽度，
                    "+"旁边空出一大截很难看。改成w-fit只包住"+"按钮本身，没有
                    链接就不用这个容器负责横向滚动 */}
                {editingId !== p.id && (() => {
                  const links = linksMap.get(p.id) ?? []
                  return (
                  <div className={`flex gap-2 mt-2.5 ${links.length > 0 ? 'overflow-x-auto no-scrollbar' : 'w-fit'}`}>
                    {links.map((link) => {
                      const badge = PLATFORM_BADGE[link.platform]
                      return (
                        <a
                          key={link.id}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative flex-shrink-0 w-[118px] rounded-xl overflow-hidden border border-line bg-card"
                        >
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              deleteWishlistPlaceLink(link.id)
                            }}
                            title={t('wishlist.delete')}
                            className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-ink/55 text-paper flex items-center justify-center"
                          >
                            <X className="w-3 h-3" strokeWidth={2.4} />
                          </button>
                          {link.thumbnailUrl ? (
                            <img src={link.thumbnailUrl} alt="" className="w-full h-[148px] object-cover block" />
                          ) : (
                            <div
                              className="w-full h-[148px] flex items-center justify-center"
                              style={{ background: `color-mix(in srgb, ${badge.color} 16%, var(--color-segment))` }}
                            >
                              <ImageOff className="w-6 h-6" style={{ color: badge.color }} strokeWidth={1.6} />
                            </div>
                          )}
                          <div className="p-1.5">
                            <div className={`text-[10.5px] leading-snug line-clamp-2 min-h-[27px] ${link.thumbnailUrl ? '' : 'text-muted italic'}`}>
                              {link.thumbnailUrl ? (link.title ?? '') : t('wishlist.linkPreviewUnavailable')}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span
                                className="w-[15px] h-[15px] rounded-full flex items-center justify-center text-[8.5px] font-bold text-card flex-shrink-0 leading-none"
                                style={{ background: badge.color }}
                              >
                                {badge.label}
                              </span>
                              <span className="text-[9.5px] text-muted truncate">{t(PLATFORM_LABEL_KEY[link.platform])}</span>
                            </div>
                          </div>
                        </a>
                      )
                    })}
                    <button
                      onClick={() => openLinkModal(p.id)}
                      title={t('wishlist.linkAdd')}
                      className="flex-shrink-0 w-[118px] h-[190px] rounded-xl border border-dashed border-line text-muted flex items-center justify-center"
                    >
                      <Plus className="w-5 h-5" strokeWidth={2} />
                    </button>
                  </div>
                  )
                })()}

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
        <CenteredModal onClose={() => !addSubmitting && setAddOpen(false)}>
          <div className="font-serif-sc text-[15px] text-ink mb-3">{t('wishlist.addTitle')}</div>
          <LocationPicker value={addLocation} onChange={setAddLocation} />
          <textarea
            value={addNotes}
            onChange={(e) => setAddNotes(e.target.value)}
            placeholder={t('wishlist.notesPlaceholder')}
            rows={2}
            disabled={addSubmitting}
            className="w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan mt-2 disabled:opacity-60"
          />
          <input
            type="text"
            value={addLinkUrl}
            onChange={(e) => setAddLinkUrl(e.target.value)}
            placeholder={t('wishlist.linkAddPlaceholder')}
            disabled={addSubmitting}
            className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan mt-2 disabled:opacity-60"
          />
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setAddOpen(false)}
              disabled={addSubmitting}
              className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center disabled:opacity-50"
              title={t('wishlist.cancel')}
            >
              <X className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <button
              onClick={confirmAdd}
              disabled={addSubmitting}
              className="flex-1 rounded-xl bg-plan text-card py-2 flex items-center justify-center disabled:opacity-50"
              title={t('wishlist.save')}
            >
              {addSubmitting && addLinkUrl.trim() ? (
                <span className="text-[11px]">{t('wishlist.linkFetching')}</span>
              ) : (
                <Check className="w-4 h-4" strokeWidth={2} />
              )}
            </button>
          </div>
        </CenteredModal>
      )}

      {linkModalPlaceId && (
        <CenteredModal onClose={() => !linkSubmitting && setLinkModalPlaceId(null)}>
          <div className="font-serif-sc text-[15px] text-ink mb-3">{t('wishlist.linkAdd')}</div>
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder={t('wishlist.linkAddPlaceholder')}
            disabled={linkSubmitting}
            autoFocus
            className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan disabled:opacity-60"
          />
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setLinkModalPlaceId(null)}
              disabled={linkSubmitting}
              className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center disabled:opacity-50"
              title={t('wishlist.cancel')}
            >
              <X className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <button
              onClick={confirmAddLink}
              disabled={linkSubmitting || !linkUrl.trim()}
              className="flex-1 rounded-xl bg-plan text-card py-2 flex items-center justify-center gap-1.5 disabled:opacity-50"
              title={t('wishlist.save')}
            >
              {linkSubmitting ? (
                <span className="text-[11px]">{t('wishlist.linkFetching')}</span>
              ) : (
                <Check className="w-4 h-4" strokeWidth={2} />
              )}
            </button>
          </div>
        </CenteredModal>
      )}
    </div>
  )
}
