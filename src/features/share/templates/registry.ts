import type { ComponentType } from 'react'
import { TicketTemplate } from './TicketTemplate'
import { EditorialTemplate } from './EditorialTemplate'
import { CollageTemplate } from './CollageTemplate'
import type { ShareTemplateProps } from './types'

export interface TemplateEntry {
  id: string
  label: string
  desc: string
  component: ComponentType<ShareTemplateProps>
}

// 已经实现、真正可选的模板——第一批只做3套验证整条链路，其余7套设计已经定好、
// 之后按同样的模式（新增一个组件文件 + 加一行到这个数组）陆续补上
export const TEMPLATE_REGISTRY: TemplateEntry[] = [
  { id: 'ticket', label: '车票凭证感', desc: '一天一张票根，出行凭证质感', component: TicketTemplate },
  { id: 'editorial', label: '时刻表编辑感', desc: '无卡片纯排版，超大号数字日期', component: EditorialTemplate },
  { id: 'collage', label: '旅途拼贴', desc: '逐日翻页，胶带贴纸感，适合截图分享', component: CollageTemplate },
]

// 已经定好设计、还没写成组件的——分享设置的模板选择器里仍然展示出来，
// 标"即将推出"并禁用，让用户知道以后会有更多选择，而不是这次就只有3个选项
export const UPCOMING_TEMPLATES: { id: string; label: string }[] = [
  { id: 'journal', label: '旅记手账风' },
  { id: 'route', label: '路线地图感' },
  { id: 'statement', label: '旅程结算单' },
  { id: 'departure-board', label: '出发信息板' },
  { id: 'gazette', label: '旅行纪事报' },
  { id: 'color-block', label: '亲子色块' },
  { id: 'glass', label: '夜航玻璃' },
]

export function getTemplate(id: string | null): TemplateEntry | undefined {
  return TEMPLATE_REGISTRY.find((t) => t.id === id)
}
