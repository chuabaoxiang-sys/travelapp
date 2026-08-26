import type { ComponentType } from 'react'
import {
  TicketThumb,
  EditorialThumb,
  CollageThumb,
  JournalThumb,
  RouteThumb,
  StatementThumb,
  DepartureBoardThumb,
  GazetteThumb,
  ColorBlockThumb,
  GlassThumb,
} from './thumbnails'

export interface PickerEntry {
  id: string
  label: string
  desc: string
  thumbnail: ComponentType
}

// ShareSettingsSheet的模板选择器只需要id/文案/手绘缩略图，从来不需要真正渲染
// 完整模板——但registry.ts为了给SharePage用，把10个完整模板组件也一起放在
// 同一个数组里，导致选择器（在主APP里，人人都会加载）连带把10套完整分享页
// 模板的真实渲染代码也打进了主包，而这些代码其实只有走/share/:token的访客
// 才用得到。这份列表只导入thumbnails.tsx（本来就是几个div拼的手绘缩略图，
// 很轻），跟真正的10个模板组件（TicketTemplate等）完全解耦
export const TEMPLATE_PICKER_LIST: PickerEntry[] = [
  { id: 'ticket', label: '车票凭证感', desc: '一天一张票根，出行凭证质感', thumbnail: TicketThumb },
  { id: 'editorial', label: '时刻表编辑感', desc: '无卡片纯排版，超大号数字日期', thumbnail: EditorialThumb },
  { id: 'collage', label: '旅途拼贴', desc: '逐日翻页，胶带贴纸感，适合截图分享', thumbnail: CollageThumb },
  { id: 'journal', label: '旅记手账风', desc: '沿用APP品牌色，胶带贴纸日期条', thumbnail: JournalThumb },
  { id: 'route', label: '路线地图感', desc: '一条纵向路线串起每一天', thumbnail: RouteThumb },
  { id: 'statement', label: '旅程结算单', desc: '金额置顶，行程作为活动记录', thumbnail: StatementThumb },
  { id: 'departure-board', label: '出发信息板', desc: '机场翻牌显示屏质感，高密度清单', thumbnail: DepartureBoardThumb },
  { id: 'gazette', label: '旅行纪事报', desc: '报纸双栏版面，最有收藏感', thumbnail: GazetteThumb },
  { id: 'color-block', label: '亲子色块', desc: '一天一个颜色循环，圆润好认', thumbnail: ColorBlockThumb },
  { id: 'glass', label: '夜航玻璃', desc: '毛玻璃卡片，安静克制', thumbnail: GlassThumb },
]

// 暂时没有还没实现的模板了——保留这个数组和UI分支，以后再加新模板时复用同样的
// "即将推出"占位模式
export const UPCOMING_TEMPLATES: { id: string; label: string }[] = []
