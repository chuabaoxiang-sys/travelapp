import type { ComponentType } from 'react'
import { TicketTemplate } from './TicketTemplate'
import { EditorialTemplate } from './EditorialTemplate'
import { CollageTemplate } from './CollageTemplate'
import { JournalTemplate } from './JournalTemplate'
import { RouteTemplate } from './RouteTemplate'
import { StatementTemplate } from './StatementTemplate'
import { DepartureBoardTemplate } from './DepartureBoardTemplate'
import { GazetteTemplate } from './GazetteTemplate'
import { ColorBlockTemplate } from './ColorBlockTemplate'
import { GlassTemplate } from './GlassTemplate'
import type { ShareTemplateProps } from './types'

export interface TemplateEntry {
  id: string
  label: string
  desc: string
  component: ComponentType<ShareTemplateProps>
}

// 全部10套模板都已实现——第一批(ticket/editorial/collage)验证了整条链路，
// 这批补齐剩余7套，色彩/字体/版式思路互不重复
export const TEMPLATE_REGISTRY: TemplateEntry[] = [
  { id: 'ticket', label: '车票凭证感', desc: '一天一张票根，出行凭证质感', component: TicketTemplate },
  { id: 'editorial', label: '时刻表编辑感', desc: '无卡片纯排版，超大号数字日期', component: EditorialTemplate },
  { id: 'collage', label: '旅途拼贴', desc: '逐日翻页，胶带贴纸感，适合截图分享', component: CollageTemplate },
  { id: 'journal', label: '旅记手账风', desc: '沿用APP品牌色，胶带贴纸日期条', component: JournalTemplate },
  { id: 'route', label: '路线地图感', desc: '一条纵向路线串起每一天', component: RouteTemplate },
  { id: 'statement', label: '旅程结算单', desc: '金额置顶，行程作为活动记录', component: StatementTemplate },
  { id: 'departure-board', label: '出发信息板', desc: '机场翻牌显示屏质感，高密度清单', component: DepartureBoardTemplate },
  { id: 'gazette', label: '旅行纪事报', desc: '报纸双栏版面，最有收藏感', component: GazetteTemplate },
  { id: 'color-block', label: '亲子色块', desc: '一天一个颜色循环，圆润好认', component: ColorBlockTemplate },
  { id: 'glass', label: '夜航玻璃', desc: '毛玻璃卡片，安静克制', component: GlassTemplate },
]

// 暂时没有还没实现的模板了——保留这个数组和UI分支，以后再加新模板时复用同样的
// "即将推出"占位模式
export const UPCOMING_TEMPLATES: { id: string; label: string }[] = []

export function getTemplate(id: string | null): TemplateEntry | undefined {
  return TEMPLATE_REGISTRY.find((t) => t.id === id)
}
