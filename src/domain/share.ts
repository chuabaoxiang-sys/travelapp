import { db } from '../db/dexie'
import { pushOutbox } from '../db/sync'
import type { PublicShareScope, Trip } from '../types'

// 这次改动之前建的行程，本地 Dexie 里压根没有 publicShareScope 这个字段——
// TypeScript 的类型只在编译期检查，不会给已经存在的旧记录补上新字段的默认值，
// 所以 trip.publicShareScope 在这些老行程上实际读到的是 undefined，不是 'none'。
// 所有要判断"到底有没有开启分享"的地方都要经过这个函数，不能直接读原始字段，
// 否则老行程会被误判成"已经开启分享"
export function effectiveShareScope(trip: Trip): PublicShareScope {
  return trip.publicShareScope ?? 'none'
}

// 打开分享面板本身绝对不能悄悄改变分享范围——第一次从'none'切到其他值时，
// 调用方(ShareSettingsSheet)必须先弹一个明确的二次确认，这里只负责真正落地写入，
// 不做"要不要确认"的判断，那是UI层的责任
//
// 这三个函数末尾都会立刻调用 pushOutbox()、而不是等每30秒一次的自动同步——
// get_shared_trip() 这个RPC读的是远端Supabase的数据，本地Dexie写完之后如果
// 不马上推上去，用户在自动同步的空档期点"预览"，远端要么还查不到这个token
// （真机复现过："首次分享/预览显示'这个链接打不开'"），要么读到切换模板之前
// 的旧模板值（真机复现过：明明选了"旅途拼贴"，预览出来的还是"车票"）。
// pushOutbox失败也不阻塞（网络问题时还是会靠原有的定时重试兜底），只是尽量
// 缩短"本地已经改了、远端还没跟上"这个窗口
export async function setShareScope(tripId: string, scope: PublicShareScope) {
  const trip = await db.trips.get(tripId)
  if (!trip) return
  // 从来没生成过token、且这次要开启分享，才需要生成一个新token；
  // 已经有token的话（哪怕之前关闭过分享）复用旧的，不用每次开关都换链接
  const needsToken = scope !== 'none' && !trip.publicShareToken
  await db.trips.update(tripId, {
    publicShareScope: scope,
    ...(needsToken ? { publicShareToken: crypto.randomUUID() } : {}),
    updatedAt: Date.now(),
  })
  await pushOutbox()
}

export async function setShareTemplate(tripId: string, template: string) {
  await db.trips.update(tripId, { publicShareTemplate: template, updatedAt: Date.now() })
  await pushOutbox()
}

// 旧链接失效、生成一个新的——用于"分享错人了想作废"这种场景
export async function regenerateShareToken(tripId: string) {
  await db.trips.update(tripId, { publicShareToken: crypto.randomUUID(), updatedAt: Date.now() })
  await pushOutbox()
}

export function buildShareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`
}
