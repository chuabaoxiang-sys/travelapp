import { db } from '../db/dexie'
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
}

export async function setShareTemplate(tripId: string, template: string) {
  await db.trips.update(tripId, { publicShareTemplate: template, updatedAt: Date.now() })
}

// 旧链接失效、生成一个新的——用于"分享错人了想作废"这种场景
export async function regenerateShareToken(tripId: string) {
  await db.trips.update(tripId, { publicShareToken: crypto.randomUUID(), updatedAt: Date.now() })
}

export function buildShareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`
}
