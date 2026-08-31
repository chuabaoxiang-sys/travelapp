import { useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureSeedData } from './db/dexie'
import { startAutoSync } from './db/sync'
import { supabase } from './api/supabaseClient'
import { getCurrentHouseholdId } from './domain/household'
import { ensureLocalTestSeed } from './dev/localTestSeed'
import { isLocalTestModeEnabled } from './dev/localTestMode'
import { LocalTestModeBanner } from './dev/LocalTestModeBanner'
import { EmailLogin } from './features/auth/EmailLogin'
import { NoHouseholdScreen } from './features/auth/NoHouseholdScreen'
import { MemberGate } from './features/members/MemberGate'
import { useCurrentMemberId } from './features/members/useCurrentMemberId'
import { TripPicker } from './features/trips/TripPicker'
import { TripShell } from './features/trips/TripShell'
import { InstallPrompt } from './components/InstallPrompt'
import { readPerTeam, writePerTeam, removePerTeam } from './lib/perTeamStorage'

const CURRENT_TRIP_KEY = 'trip-journal:current-trip-id'

// 本地测试模式/没配Supabase时用的团队ID，跟 domain/household.ts 里的常量保持一致——
// 那种场景下也需要一个稳定的值给"按团队分开存"的那两个记忆键当后缀
const LOCAL_TEST_HOUSEHOLD_ID = 'local-test-household'

type AuthState = 'checking' | 'signed-out' | 'no-household' | 'ready'

function App() {
  const [ready, setReady] = useState(false)
  const [authState, setAuthState] = useState<AuthState>('checking')
  // 当前团队ID在这里解析一次并持有：下面"当前身份"和"当前行程"两个记忆值都要按团队
  // 分开存，而它们在首次渲染时就要同步读到值，来不及等异步查询。切换团队后这个值会变，
  // 那两个记忆值也会跟着切到新团队记住的那份
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [memberId, setMemberId] = useCurrentMemberId(householdId)
  const [tripId, setTripId] = useState<string | null>(null)

  // 记住的这个身份，在当前团队的数据里必须真的存在。不校验的话，一旦记住的ID
  // 属于别的团队（或者这个人在别的设备上被删了），APP 会带着一个查不到的身份继续跑：
  // 头像变成"?"，而且因为 memberId 有值，"你是谁？"那一屏被整个跳过——真机上就是
  // 这么暴露出来的。跟之前修过的"记住的行程已不存在导致白屏"是同一类问题。
  // useLiveQuery 没查完时返回 undefined，这时不能判定"不存在"，否则数据还没拉回来
  // 就会把人弹回选身份；只有确实拿到数组、里面没有这个ID，才算真的失效
  const allMembers = useLiveQuery(() => db.members.toArray(), [householdId])
  const memberMissing = !!memberId && !!allMembers && !allMembers.some((m) => m.id === memberId)
  const effectiveMemberId = memberMissing ? null : memberId

  // 跟着当前团队走：切换团队时读新团队上次看的那趟行程（没有就落到"我的行程"列表）
  useEffect(() => {
    setTripId(householdId ? readPerTeam(CURRENT_TRIP_KEY, householdId) : null)
  }, [householdId])

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
    if (!supabase || isLocalTestModeEnabled()) {
      setHouseholdId(LOCAL_TEST_HOUSEHOLD_ID)
      setAuthState('ready')
      return
    }

    async function checkSession(session: import('@supabase/supabase-js').Session | null) {
      if (!session) {
        setHouseholdId(null)
        setAuthState('signed-out')
        return
      }
      const resolved = await getCurrentHouseholdId()
      setHouseholdId(resolved)
      setAuthState(resolved ? 'ready' : 'no-household')
      if (resolved) startAutoSync()
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

  let content: ReactNode

  if (authState === 'signed-out') {
    content = <EmailLogin />
  } else if (authState === 'no-household') {
    content = (
      <NoHouseholdScreen
        onSignOut={() => setAuthState('signed-out')}
        onHouseholdCreated={(id) => {
          setHouseholdId(id)
          setAuthState('ready')
          startAutoSync()
        }}
      />
    )
  } else if (!effectiveMemberId) {
    content = (
      <>
        <MemberGate onPicked={setMemberId} />
        <InstallPrompt />
      </>
    )
  } else if (!tripId) {
    content = (
      <>
        <TripPicker
          currentMemberId={effectiveMemberId}
          onSelect={(id) => {
            if (householdId) writePerTeam(CURRENT_TRIP_KEY, householdId, id)
            setTripId(id)
          }}
        />
        <InstallPrompt />
      </>
    )
  } else {
    content = (
      <>
        <TripShell
          tripId={tripId}
          currentMemberId={effectiveMemberId}
          onSwitchTrip={() => {
            if (householdId) removePerTeam(CURRENT_TRIP_KEY, householdId)
            setTripId(null)
          }}
          onSelectMember={setMemberId}
        />
        <InstallPrompt />
      </>
    )
  }

  return (
    <>
      {import.meta.env.DEV && isLocalTestModeEnabled() && <LocalTestModeBanner />}
      {content}
    </>
  )
}

export default App
