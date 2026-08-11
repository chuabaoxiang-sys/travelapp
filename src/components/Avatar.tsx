import type { Member } from '../types'

export function Avatar({ member, size = 26 }: { member: Member | null | undefined; size?: number }) {
  return (
    <span
      className="rounded-full flex items-center justify-center text-card font-serif-sc flex-shrink-0"
      style={{ background: member?.colorTag ?? '#57534E', width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {member?.displayName.slice(0, 1) ?? '?'}
    </span>
  )
}
