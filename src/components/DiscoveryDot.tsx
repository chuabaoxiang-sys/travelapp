import { useLiveQuery } from 'dexie-react-hooks'
import { hasSeenHint } from '../domain/discoveryHints'

// 入口"发现提示"小红点——点了对应按钮就永久消失，不会再提醒第二次（按人记，
// 不是按设备）。查询结果是undefined的那一瞬间（还没查出来）先不闪一下红点，
// 只有确认没看过（false）才显示，避免打开页面的第一帧闪一下又消失
export function DiscoveryDot({
  memberId,
  hintKey,
  borderClassName = 'border-paper',
}: {
  memberId: string
  hintKey: string
  borderClassName?: string
}) {
  const seen = useLiveQuery(() => hasSeenHint(memberId, hintKey), [memberId, hintKey])
  if (seen !== false) return null
  return <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-negative border-[1.5px] ${borderClassName}`} />
}
