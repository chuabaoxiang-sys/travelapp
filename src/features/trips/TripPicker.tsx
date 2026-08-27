import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil, Trash2, X, Check, Plus, Bookmark, BookOpen } from 'lucide-react'
import { db, deleteTripCascade } from '../../db/dexie'
import { getCurrentHouseholdId } from '../../domain/household'
import { computeTripStatus } from '../../domain/trips'
import { DatePicker } from '../../components/DatePicker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CountryPicker } from '../../components/CountryPicker'
import { CurrencyPicker } from '../../components/CurrencyPicker'
import { countryByCode } from '../../lib/countries'
import { WishlistScreen } from '../wishlist/WishlistScreen'
import { TeamSwitcher } from '../teams/TeamSwitcher'
import { useBackDismiss } from '../../hooks/useBackDismiss'
import { DiscoveryDot } from '../../components/DiscoveryDot'
import { markHintSeen } from '../../domain/discoveryHints'
import type { Trip, TripStatus } from '../../types'

const STATUS_LABEL: Record<TripStatus, string> = {
  planning: '规划中',
  active: '进行中',
  completed: '已结束',
  archived: '已归档',
}

const STATUS_CLASS: Record<TripStatus, string> = {
  planning: 'bg-spend/15 text-spend',
  active: 'bg-positive/15 text-positive',
  completed: 'bg-line text-muted',
  archived: 'bg-line text-muted',
}

// 新建行程时本位币的快捷选项——马来西亚家庭的常见目的地/常用币种，
// 选不到的话"其他"展开手动输入，跟"记一笔"里币种选择的交互一致
const HOME_CURRENCY_QUICK_PICKS = ['MYR', 'SGD', 'CNY', 'USD', 'THB']

export function TripPicker({ onSelect, currentMemberId }: { onSelect: (id: string) => void; currentMemberId: string }) {
  const trips = useLiveQuery(() => db.trips.orderBy('createdAt').reverse().toArray()) ?? []
  // null=不显示表单；'new'=新建（表单出现在列表最下面）；具体id=正在编辑该行程
  // （编辑表单原地替换那张卡片，不要跑到列表底部，否则行程一多就分不清在改哪个）
  const [formState, setFormState] = useState<'new' | string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Trip | null>(null)
  const [wishlistOpen, setWishlistOpen] = useState(false)
  useBackDismiss(wishlistOpen, () => setWishlistOpen(false))

  async function confirmRemoveTrip() {
    if (!pendingDelete) return
    const id = pendingDelete.id
    await deleteTripCascade(id)
    if (formState === id) setFormState(null)
    setPendingDelete(null)
  }

  return (
    <div className="relative min-h-screen bg-ink p-6 flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="text-[11px] tracking-widest text-card/50 uppercase">旅记 · TripJournal</div>
        <div className="flex items-center justify-between mt-2">
          <h1 className="font-serif-sc text-2xl text-card">我的行程</h1>
          <button
            onClick={() => { setWishlistOpen(true); markHintSeen(currentMemberId, 'wishlist') }}
            className="relative flex items-center gap-1.5 rounded-full border border-card/20 bg-card/10 text-card px-3 py-1.5 text-[11.5px] font-semibold"
          >
            <Bookmark className="w-3.5 h-3.5" strokeWidth={2} />
            想去的地点
            <DiscoveryDot memberId={currentMemberId} hintKey="wishlist" borderClassName="border-ink" />
          </button>
        </div>

        <TeamSwitcher />

        <div className="mt-5 flex flex-col gap-2">
          {trips.map((t) => {
            // 正在编辑这趟行程：表单原地替换这张卡片，而不是丢到列表最下面
            if (formState === t.id) {
              return (
                <TripForm
                  key={t.id}
                  initial={t}
                  onDone={() => setFormState(null)}
                  onCancel={() => setFormState(null)}
                  onDelete={() => setPendingDelete(t)}
                />
              )
            }
            return (
              <div key={t.id} className="bg-card border border-line rounded-2xl p-4 hover:border-plan/50 transition-colors">
                <button onClick={() => onSelect(t.id)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-serif-sc text-[15px] text-ink truncate">{t.name}</div>
                      <div className="text-[11px] text-muted mt-1 tabular truncate">
                        {t.startDate ?? '日期未定'} {t.endDate ? `– ${t.endDate}` : ''} · {t.homeCurrency}
                        {!!t.destinationCountries?.length && (
                          <span> · {t.destinationCountries.map((c) => countryByCode(c)?.nameZh ?? c).join('/')}</span>
                        )}
                      </div>
                    </div>
                    {(() => {
                      const status = computeTripStatus(t)
                      return (
                        <span className={`text-[10.5px] px-2.5 py-1 rounded-full flex-shrink-0 ${STATUS_CLASS[status]}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      )
                    })()}
                  </div>
                </button>
                <div className="flex gap-3 mt-2.5 pt-2.5 border-t border-line">
                  <button
                    onClick={() => setFormState(t.id)}
                    className="text-muted hover:text-plan"
                    title="编辑"
                  >
                    <Pencil className="w-[15px] h-[15px]" strokeWidth={1.8} />
                  </button>
                  <button
                    onClick={() => setPendingDelete(t)}
                    className="text-muted hover:text-negative"
                    title="删除"
                  >
                    <Trash2 className="w-[15px] h-[15px]" strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {formState === 'new' ? (
          <TripForm
            onDone={(id) => {
              setFormState(null)
              onSelect(id)
            }}
            onCancel={() => setFormState(null)}
          />
        ) : (
          !formState && (
            <>
              <button
                onClick={() => setFormState('new')}
                className="mt-3 w-full rounded-2xl border border-dashed border-plan/60 text-card bg-plan py-3 text-sm font-medium flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" strokeWidth={2} />
                新建行程
              </button>
              {!trips.length && (
                <a
                  href="/user-guide.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3.5 w-full flex items-center justify-center gap-1.5 text-[12px] text-plan-on-dark"
                >
                  <BookOpen className="w-[13px] h-[13px]" strokeWidth={1.8} />
                  第一次用？先看使用指南
                </a>
              )}
            </>
          )
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`删除行程「${pendingDelete.name}」？`}
          message="这会同时删除它名下所有的行程安排和账目记录，无法恢复。"
          onConfirm={confirmRemoveTrip}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {wishlistOpen && (
        <WishlistScreen currentMemberId={currentMemberId} onClose={() => setWishlistOpen(false)} />
      )}
    </div>
  )
}

function TripForm({
  initial,
  onDone,
  onCancel,
  onDelete,
}: {
  initial?: Trip
  onDone: (id: string) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [endDate, setEndDate] = useState(initial?.endDate ?? '')
  const [destinationCountries, setDestinationCountries] = useState<string[]>(initial?.destinationCountries ?? [])
  const [currencies, setCurrencies] = useState<string[]>(initial?.currencies ?? [])
  const [homeCurrency, setHomeCurrency] = useState('MYR')
  const [manualHomeCurrencyOpen, setManualHomeCurrencyOpen] = useState(false)

  async function save() {
    if (!name.trim()) return
    if (initial) {
      await db.trips.update(initial.id, {
        name: name.trim(),
        startDate: startDate || null,
        endDate: endDate || null,
        destinationCountries,
        currencies,
        updatedAt: Date.now(),
      })
      onDone(initial.id)
    } else {
      const householdId = await getCurrentHouseholdId()
      if (!householdId) return
      const id = crypto.randomUUID()
      const now = Date.now()
      const trip: Trip = {
        id,
        householdId,
        name: name.trim(),
        homeCurrency: homeCurrency.trim().toUpperCase() || 'MYR',
        startDate: startDate || null,
        endDate: endDate || null,
        status: startDate ? 'active' : 'planning',
        publicShareScope: 'none',
        publicShareToken: null,
        publicShareTemplate: null,
        destinationCountries,
        currencies,
        createdAt: now,
        updatedAt: now,
      }
      await db.trips.add(trip)
      onDone(id)
    }
  }

  return (
    <div className="mt-3 bg-card border border-plan/40 rounded-2xl p-4 flex flex-col gap-2.5">
      <div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="行程名称"
          className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-plan"
        />
        <div className="text-[10.5px] text-muted mt-1">例如「2026日本关西家族游」</div>
      </div>
      <div className="flex gap-2">
        <div className="flex-1"><DatePicker value={startDate ?? ''} onChange={setStartDate} placeholder="出发日期" /></div>
        <div className="flex-1"><DatePicker value={endDate ?? ''} onChange={setEndDate} placeholder="返程日期" /></div>
      </div>
      <CountryPicker value={destinationCountries} onChange={setDestinationCountries} />
      {!initial && (
        <div>
          <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1.5">本位币</div>
          <div className="flex flex-wrap gap-1.5">
            {HOME_CURRENCY_QUICK_PICKS.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => { setHomeCurrency(code); setManualHomeCurrencyOpen(false) }}
                className={`rounded-full px-3 py-1 text-[12.5px] font-medium border ${
                  !manualHomeCurrencyOpen && homeCurrency === code ? 'bg-plan text-card border-plan' : 'border-line text-soft'
                }`}
              >
                {code}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setManualHomeCurrencyOpen(true)}
              className={`rounded-full px-3 py-1 text-[12.5px] border ${
                manualHomeCurrencyOpen ? 'bg-plan text-card border-plan' : 'border-line text-muted'
              }`}
            >
              其他
            </button>
          </div>
          {manualHomeCurrencyOpen && (
            <input
              value={homeCurrency}
              onChange={(e) => setHomeCurrency(e.target.value.toUpperCase())}
              placeholder="币种代码，比如 KRW"
              autoFocus
              className="mt-1.5 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm uppercase outline-none focus:border-plan"
            />
          )}
          <div className="text-[10.5px] text-muted mt-1">整趟行程的花费都会折算成这个币种</div>
        </div>
      )}
      <CurrencyPicker homeCurrency={initial?.homeCurrency ?? homeCurrency} value={currencies} onChange={setCurrencies} />
      <div className="flex gap-2 mt-1">
        {onDelete && (
          <button onClick={onDelete} className="rounded-xl border border-negative/30 text-negative px-3 py-2" title="删除">
            <Trash2 className="w-4 h-4" strokeWidth={1.8} />
          </button>
        )}
        <button onClick={onCancel} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title="取消">
          <X className="w-4 h-4" strokeWidth={1.8} />
        </button>
        <button onClick={save} className="flex-1 rounded-xl bg-plan text-card py-2 flex items-center justify-center" title={initial ? '保存修改' : '创建'}>
          <Check className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
