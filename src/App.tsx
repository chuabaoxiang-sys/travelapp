import { useEffect, useState } from 'react'
import { ensureSeedData } from './db/dexie'
import { startAutoSync } from './db/sync'
import { supabase } from './api/supabaseClient'
import { getCurrentHouseholdId, signOut } from './domain/household'
import { ensureLocalTestSeed } from './dev/localTestSeed'
import { EmailLogin } from './features/auth/EmailLogin'
import { MemberGate } from './features/members/MemberGate'
import { useCurrentMemberId } from './features/members/useCurrentMemberId'
import { TripPicker } from './features/trips/TripPicker'
import { TripShell } from './features/trips/TripShell'
import { InstallPrompt } from './components/InstallPrompt'

const CURRENT_TRIP_KEY = 'trip-journal:current-trip-id'

type AuthState = 'checking' | 'signed-out' | 'no-household' | 'ready'

function App() {
  const [ready, setReady] = useState(false)
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [memberId, setMemberId] = useCurrentMemberId()
  const [tripId, setTripId] = useState<string | null>(() => localStorage.getItem(CURRENT_TRIP_KEY))

  useEffect(() => {
    // ensureLocalTestSeed 内部自己判断"是不是本地无Supabase测试环境"，
    // 真机/生产环境这里相当于no-op——见 dev/localTestSeed.ts 的说明
    ensureSeedData()
      .then(() => ensureLocalTestSeed())
      .then(() => setReady(true))
  }, [])

  // 没配置Supabase（比如本地没建.env.local）时不要卡在登录屏，直接放行——
  // 跟原来"同步功能整体不工作但APP能用"的降级逻辑保持一致
  useEffect(() => {
    if (!supabase) {
      setAuthState('ready')
      return
    }

    async function checkSession(session: import('@supabase/supabase-js').Session | null) {
      if (!session) {
        setAuthState('signed-out')
        return
      }
      const householdId = await getCurrentHouseholdId()
      setAuthState(householdId ? 'ready' : 'no-household')
      if (householdId) startAutoSync()
    }

    // 只依赖 onAuthStateChange——它保证第一次回调一定是 INITIAL_SESSION 事件，带着
    // 客户端读完本地存储、校验完毕之后"确定性"的会话状态。之前这里还额外单独调了
    // 一次 getSession()，是多余的，且有竞态风险：APP真正冷启动时（不是切到后台再切
    // 回来），如果这个单独调用抢在客户端读完本地存储之前就跑完，会拿到"没有会话"的
    // 错误结果，导致明明本地存着有效登录状态却被误判成"未登录"，弹出登录页要求重新
    // 输入邮箱——这正是真机测试时发现的那个bug
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      checkSession(session)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready || authState === 'checking') return null

  if (authState === 'signed-out') {
    return <EmailLogin />
  }

  if (authState === 'no-household') {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-card rounded-3xl p-6 border border-line text-center">
          <div className="text-[11px] tracking-widest text-muted uppercase">旅记 · TripJournal</div>
          <h1 className="font-serif-sc text-xl mt-2 text-ink">这个邮箱还没被邀请</h1>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            这个邮箱还没有加入任何团队，联系邀请你的人确认一下邮箱是否填对了。
          </p>
          <button
            onClick={() => signOut().then(() => setAuthState('signed-out'))}
            className="mt-4 text-[12.5px] text-plan"
          >
            换个邮箱重新登录
          </button>
        </div>
      </div>
    )
  }

  if (!memberId) {
    return (
      <>
        <MemberGate onPicked={setMemberId} />
        <InstallPrompt />
      </>
    )
  }

  if (!tripId) {
    return (
      <>
        <TripPicker
          onSelect={(id) => {
            localStorage.setItem(CURRENT_TRIP_KEY, id)
            setTripId(id)
          }}
        />
        <InstallPrompt />
      </>
    )
  }

  return (
    <>
      <TripShell
        tripId={tripId}
        currentMemberId={memberId}
        onSwitchTrip={() => {
          localStorage.removeItem(CURRENT_TRIP_KEY)
          setTripId(null)
        }}
        onSelectMember={setMemberId}
      />
      <InstallPrompt />
    </>
  )
}

export default App
