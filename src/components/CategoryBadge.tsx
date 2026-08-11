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

export function CategoryBadge({
  category,
  size = 34,
  rounded = 10,
}: {
  category: ExpenseCategory | null | undefined
  size?: number
  rounded?: number
}) {
  return (
    <div
      className="text-card flex items-center justify-center flex-shrink-0"
      style={{ background: categoryColor(category), width: size, height: size, borderRadius: rounded }}
    >
      <CategoryIcon category={category} size={Math.round(size * 0.44)} />
    </div>
  )
}
