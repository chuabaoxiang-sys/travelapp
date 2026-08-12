import { useEffect, useState } from 'react'
import { ensureSeedData } from './db/dexie'
import { startAutoSync } from './db/sync'
import { MemberGate } from './features/members/MemberGate'
import { useCurrentMemberId } from './features/members/useCurrentMemberId'
import { TripPicker } from './features/trips/TripPicker'
import { TripShell } from './features/trips/TripShell'
import { InstallPrompt } from './components/InstallPrompt'

const CURRENT_TRIP_KEY = 'trip-journal:current-trip-id'

function App() {
  const [ready, setReady] = useState(false)
  const [memberId, setMemberId] = useCurrentMemberId()
  const [tripId, setTripId] = useState<string | null>(() => localStorage.getItem(CURRENT_TRIP_KEY))

  useEffect(() => {
    ensureSeedData().then(() => setReady(true))
    startAutoSync()
  }, [])

  if (!ready) return null

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
