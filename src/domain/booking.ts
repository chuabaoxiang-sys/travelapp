import type { BookingStatus } from '../types'

// 行程卡片上的徽章只做"快速切换"——点一下在 needed/booked 之间来回，绝不会
// 切回 null。回到"不需要预约"必须进编辑表单里选，是刻意更郑重一点的动作，
// 不该靠点徽章误触就发生（真实反馈过：三态循环点两下就消失，让人摸不着头脑）
export function toggleBookingStatus(status: BookingStatus): BookingStatus {
  return status === 'booked' ? 'needed' : 'booked'
}
