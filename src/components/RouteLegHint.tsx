import { Navigation } from 'lucide-react'
import type { RouteLeg } from '../types'
import { buildMapsUrl, formatRouteLeg, isLegLinkable } from '../lib/routeLegs'

// 相邻两个行程项之间的一行提示——有真实坐标时可以点击跳转 Google Maps 路线
// （不锁定通行方式，用户自己在地图里选步行/开车/公交，点开链接后手机系统
// 会自然弹出"用哪个导航App打开"的选择，网页版就是正常打开新分页，不需要
// 额外判断设备类型）。没有坐标（'missing-coords'）时只是纯文字，没法生成链接。
// 跳转动作用图标（Navigation）而不是文字按钮，跟全APP"动作用图标优先"的风格保持一致——
// API失败时没有距离/时长数据可显示，这种情况下这一行就只剩图标本身，靠 title 提示用途
export function RouteLegHint({ leg }: { leg: RouteLeg | undefined }) {
  if (!leg) return null

  // w-fit：这一行是itinerary列表那个flex-col容器里的一个子项，容器没设align-items，
  // 默认stretch会让它拉伸到整行宽——可点的<a>版本因此会把整行空白也变成可点区域，
  // 点哪都跳去Google Maps，容易误触。加w-fit让容器只跟内容一样宽，点击区域收回到
  // 文字+图标本身
  const className = 'text-[11px] text-muted pl-2 -my-0.5 flex items-center gap-1 w-fit'

  if (!isLegLinkable(leg)) {
    const text = formatRouteLeg(leg)
    if (!text) return null
    return (
      <div className={className}>
        <span className="opacity-50">↳</span> {text}
      </div>
    )
  }

  const text = formatRouteLeg(leg)
  return (
    <a
      href={buildMapsUrl(leg.from, leg.to)}
      target="_blank"
      rel="noopener noreferrer"
      title="在地图中查看路线"
      className={`${className} hover:text-plan`}
    >
      <span className="opacity-50">↳</span>
      {text && <span>{text}</span>}
      <Navigation className="w-3 h-3" strokeWidth={1.8} />
    </a>
  )
}
