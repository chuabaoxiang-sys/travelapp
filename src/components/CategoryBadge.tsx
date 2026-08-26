import type { ComponentType } from 'react'
import { UtensilsCrossed, Car, ShoppingBag, Ticket, BedDouble, Package, Plane, ShieldCheck, FileText } from 'lucide-react'
import { categoryColor } from '../lib/categoryColors'
import type { ExpenseCategory } from '../types'

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>

const CATEGORY_ICONS: Record<string, IconComponent> = {
  'seed-cat-insurance': ShieldCheck,
  'seed-cat-flight': Plane,
  'seed-cat-visa': FileText,
  'seed-cat-stay-prepaid': BedDouble,
  'seed-cat-food': UtensilsCrossed,
  'seed-cat-transport': Car,
  'seed-cat-shopping': ShoppingBag,
  'seed-cat-ticket': Ticket,
  'seed-cat-stay-onsite': BedDouble,
  'seed-cat-misc': Package,
}

export function CategoryIcon({ category, size = 15 }: { category: ExpenseCategory | null | undefined; size?: number }) {
  const Icon = (category && CATEGORY_ICONS[category.id]) ?? Package
  return <Icon size={size} strokeWidth={2} />
}

// 方案B：分类标记从"填色方块+图标"改成"3px色条+行内小图标"——颜色和图标都保留
// （用户明确要求过，不是只留颜色），只是不再用一个独立的填色方块承载图标。
// 色条负责"扫一眼认出这是哪类"，图标补充"具体是哪个分类"，两者作为一个整体
// 紧贴在一起（内部自己的gap-1.5），调用方原来"一个CategoryBadge占一个flex item"
// 的用法不用改
export function CategoryBadge({
  category,
  barHeight = 26,
  iconSize = 15,
}: {
  category: ExpenseCategory | null | undefined
  barHeight?: number
  iconSize?: number
}) {
  const color = categoryColor(category)
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <span className="w-[3px] rounded-full flex-shrink-0" style={{ height: barHeight, background: color }} />
      <span className="flex items-center flex-shrink-0" style={{ color }}>
        <CategoryIcon category={category} size={iconSize} />
      </span>
    </div>
  )
}
