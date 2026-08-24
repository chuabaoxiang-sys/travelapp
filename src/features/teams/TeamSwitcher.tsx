import { useEffect, useState } from 'react'
import { Users, ChevronDown, Check, Circle, AlertCircle, X } from 'lucide-react'
import { listMyHouseholds, type MyHousehold } from '../../domain/household'
import { switchTeam, countPendingSync, PendingSyncError } from '../../domain/teamSwitch'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useBackDismiss } from '../../hooks/useBackDismiss'

// 团队切换入口。刻意只在"属于2个以上团队"时才渲染任何东西——绝大多数人只属于
// 一个团队，给他们加一行永远用不到的东西是纯噪音。
export function TeamSwitcher() {
  const [teams, setTeams] = useState<MyHousehold[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    listMyHouseholds().then(setTeams)
  }, [])

  if (teams.length < 2) return null
  const current = teams.find((t) => t.isActive) ?? teams[0]

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full mt-3 flex items-center gap-2 rounded-[13px] border border-card/20 bg-card/[0.07] px-3 py-2 text-left"
      >
        <Users className="w-[13px] h-[13px] text-card/55 flex-shrink-0" strokeWidth={2} />
        <span className="flex-1 min-w-0">
          <span className="block text-[9px] tracking-[0.16em] uppercase text-card/45">团队</span>
          <span className="block font-serif-sc text-[13px] text-card font-semibold truncate">{current.name}</span>
        </span>
        <ChevronDown className="w-[14px] h-[14px] text-card/60 flex-shrink-0" strokeWidth={2} />
      </button>

      {open && <TeamSwitchSheet teams={teams} onClose={() => setOpen(false)} />}
    </>
  )
}

function TeamSwitchSheet({ teams, onClose }: { teams: MyHousehold[]; onClose: () => void }) {
  // 打开弹层时就查一次待同步条数：有没推上去的记录时不能切（那些记录带着旧团队的
  // household_id，切过去会被RLS永久拒绝），所以直接把选项禁用掉并说明原因，
  // 而不是让人点了之后才报错
  const [pending, setPending] = useState<number | null>(null)
  const [switching, setSwitching] = useState<MyHousehold | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    countPendingSync().then(setPending)
  }, [])

  // 切换过程中不允许用Escape/返回键关掉——中途打断会留下"服务端已切、本地还没拉完"
  // 的错位状态
  useEscapeKey(!switching, onClose)
  useBackDismiss(!switching, onClose)

  async function pick(team: MyHousehold) {
    if (team.isActive || switching || pending) return
    setSwitching(team)
    setError(null)
    try {
      await switchTeam(team.id)
      // 切换成功后整页重载，而不是把新的团队ID往React状态里传。
      // 换团队等于把APP的地基换掉了：本地数据库刚被清空重建、当前身份和当前行程
      // 都属于另一个团队、模块级缓存（getCurrentHouseholdId 的 cachedHouseholdId）
      // 和一堆 useLiveQuery 订阅都要跟着变。逐个去追这些状态残留会没完没了——
      // 第一版就是这么做的，结果切完界面还显示旧团队名，看起来像没生效。
      // 重载一次让所有状态从头构建，是这种"全局上下文切换"最可靠的做法；
      // 这个动作本来就很少发生，多等一次加载完全值得。
      window.location.reload()
    } catch (err) {
      setSwitching(null)
      setError(
        err instanceof PendingSyncError
          ? `还有 ${err.pendingCount} 条记录没同步上去，等同步完再切`
          : '切换失败，检查一下网络再试',
      )
      void countPendingSync().then(setPending)
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <div className="flex-1 bg-scrim/40" onClick={switching ? undefined : onClose} />
      <div className="bg-paper rounded-t-[22px] px-4 pt-2.5 pb-6 shadow-[0_-10px_40px_rgba(31,27,22,0.2)]">
        <div className="w-[34px] h-[3px] rounded-full bg-handle mx-auto mb-3" />

        <div className="flex items-center justify-between mb-1">
          <span className="text-[12.5px] font-semibold text-ink">切换团队</span>
          {!switching && (
            <button onClick={onClose} className="text-muted" title="关闭">
              <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
            </button>
          )}
        </div>

        {switching ? (
          <div className="text-center py-6">
            <div className="w-6 h-6 mx-auto mb-2.5 rounded-full border-2 border-plan/20 border-t-plan animate-spin motion-reduce:animate-none" />
            <div className="font-serif-sc text-[14px] text-ink font-semibold">正在切换到 {switching.name}</div>
            <div className="text-[11px] text-muted mt-1">重新下载这个团队的数据，稍等一下</div>
          </div>
        ) : (
          <>
            <div className="text-[11px] text-muted leading-relaxed mb-3">
              每个团队的行程和账目完全独立，互相看不到。
            </div>

            {!!pending && (
              <div className="flex gap-1.5 items-start rounded-xl border border-spend/30 bg-spend/10 px-2.5 py-2 mb-2.5 text-[11px] leading-relaxed text-spend-text">
                <AlertCircle className="w-[13px] h-[13px] mt-[2px] flex-shrink-0" strokeWidth={2.2} />
                <span>
                  还有 <span className="font-semibold">{pending} 条</span>记录没同步上去。等它们同步完再切，不然这几条会丢。
                </span>
              </div>
            )}

            {error && <div className="text-[11px] text-negative mb-2.5">{error}</div>}

            <div className="flex flex-col gap-1.5">
              {teams.map((t) => {
                const disabled = !t.isActive && !!pending
                return (
                  <button
                    key={t.id}
                    onClick={() => pick(t)}
                    disabled={disabled}
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left ${
                      t.isActive ? 'border-plan bg-plan/[0.06]' : 'border-line bg-card'
                    } ${disabled ? 'opacity-40' : ''}`}
                  >
                    {t.isActive ? (
                      <Check className="w-[13px] h-[13px] text-plan flex-shrink-0" strokeWidth={2.4} />
                    ) : (
                      <Circle className="w-[13px] h-[13px] text-line flex-shrink-0" strokeWidth={2} />
                    )}
                    <span className="flex-1 font-serif-sc text-[13px] text-ink font-semibold truncate">{t.name}</span>
                    {t.isActive && <span className="text-[9.5px] text-plan font-bold flex-shrink-0">当前</span>}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
