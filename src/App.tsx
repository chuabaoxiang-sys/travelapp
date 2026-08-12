import { useEffect, useState } from 'react'
import { ensureSeedData } from './db/dexie'
import { startAutoSync } from './db/sync'
import { supabase } from './api/supabaseClient'
import { getCurrentHouseholdId, signOut } from './domain/household'
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
    ensureSeedData().then(() => setReady(true))
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

    supabase.auth.getSession().then(({ data }) => checkSession(data.session))
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
