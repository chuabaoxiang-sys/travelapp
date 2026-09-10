import { Compass, Map, Wallet, PiggyBank, Heart, RefreshCw, Settings, Lock, type LucideIcon } from 'lucide-react'

// 红圈位置——百分比，相对390×844视口，用Playwright量真实DOM boundingBox()算出来的，
// 不是肉眼估的（见 scripts/capture-tutorial-shots.cjs）。不是每一步都需要圈：纯展示性的
// 步骤（比如"概览页出发前的样子"）省略ring，让读者看整体效果就好
export interface TutorialStepRing {
  left: number
  top: number
  width: number
  height: number
}

export interface TutorialStep {
  id: string
  ring?: TutorialStepRing
}

export interface Tutorial {
  id: string
  icon: LucideIcon
  stepIds: string[]
}

// 截图文件名跟 stepId 一一对应：public/tutorial-shots/<stepId>.png（中文）、
// <stepId>-en.png（英文）——两份图分开截，因为APP界面里的分类名、金额这些文字
// 本身也是跟着语言走的，不能一张中文截图配英文说明
export const TUTORIALS: Tutorial[] = [
  {
    id: 'quickstart',
    icon: Compass,
    stepIds: ['quickstart-1', 'quickstart-2', 'quickstart-3', 'quickstart-4', 'quickstart-5'],
  },
  {
    id: 'itinerary',
    icon: Map,
    stepIds: ['itinerary-1', 'itinerary-2', 'itinerary-3', 'itinerary-4', 'itinerary-5', 'itinerary-6', 'itinerary-7', 'itinerary-8'],
  },
  {
    id: 'ledgerSettle',
    icon: Wallet,
    stepIds: [
      'ledger-settle-1',
      'ledger-settle-2',
      'ledger-settle-3',
      'ledger-settle-4',
      'ledger-settle-5',
      'ledger-settle-6',
      'ledger-settle-7',
      'ledger-settle-8',
      'ledger-settle-9',
      'ledger-settle-10',
    ],
  },
  {
    id: 'budget',
    icon: PiggyBank,
    stepIds: ['budget-1', 'budget-2', 'budget-3', 'budget-4'],
  },
  {
    id: 'wishlist',
    icon: Heart,
    stepIds: ['wishlist-1', 'wishlist-2', 'wishlist-3', 'wishlist-4', 'wishlist-5'],
  },
  {
    id: 'rates',
    icon: RefreshCw,
    stepIds: ['rates-1', 'rates-2', 'rates-3', 'rates-4'],
  },
  {
    id: 'settings',
    icon: Settings,
    stepIds: ['settings-1', 'settings-2', 'settings-3', 'settings-4', 'settings-5'],
  },
  {
    id: 'tripLimit',
    icon: Lock,
    stepIds: ['trip-limit-1', 'trip-limit-2'],
  },
]

// 红圈坐标——scripts/capture-tutorial-shots.cjs 跑完后打印的JSON直接抄进来，中英文
// 分开各存一份：同一个操作在两种语言下，文字长度不同会撑开/收窄容器（比如英文的
// 分类标签换行更多、按钮文案更长），红圈位置和大小因此并不总是一样，用同一份坐标
// 硬套两种语言会出现圈歪的情况。没有出现在下面两张表里的 stepId 就是没有ring
// （纯展示性画面，比如"概览页出发前的样子"，让读者看整体效果就好）
export const STEP_RINGS_ZH: Record<string, TutorialStepRing> = {
  'quickstart-5': { left: 4.6, top: 76.7, width: 90.8, height: 6.9 },
  'itinerary-1': { left: 3.6, top: 13.2, width: 48.1, height: 6 },
  'itinerary-3': { left: 3.6, top: 32.6, width: 92.8, height: 9.5 },
  'itinerary-4': { left: 5.1, top: 75.1, width: 42.3, height: 5.1 },
  'itinerary-5': { left: 86.7, top: 19.7, width: 11.8, height: 5.5 },
  'itinerary-6': { left: 75.4, top: 13.6, width: 11.3, height: 5.2 },
  'itinerary-7': { left: 3.6, top: 28.7, width: 54.4, height: 3.8 },
  'itinerary-8': { left: 3.6, top: 28.7, width: 92.8, height: 14 },
  'ledger-settle-1': { left: 42.8, top: 90.8, width: 14.4, height: 6.9 },
  'ledger-settle-2': { left: 5.1, top: 60, width: 89.7, height: 12.8 },
  'ledger-settle-3': { left: 9, top: 66.6, width: 82.1, height: 4.8 },
  'ledger-settle-4': { left: 5.1, top: 88.7, width: 89.7, height: 11 },
  'ledger-settle-5': { left: 5.1, top: 79.8, width: 89.7, height: 17.1 },
  'ledger-settle-6': { left: 3.6, top: 64.1, width: 92.8, height: 8.3 },
  'ledger-settle-7': { left: 10.8, top: 40.1, width: 78.5, height: 5 },
  'ledger-settle-8': { left: 3.6, top: 24.1, width: 92.8, height: 189.6 },
  'ledger-settle-9': { left: 79, top: 60.7, width: 13.1, height: 3.5 },
  'ledger-settle-10': { left: 3.6, top: 76.5, width: 92.8, height: 34.8 },
  'budget-1': { left: 6.2, top: 54.1, width: 87.7, height: 13.1 },
  'budget-2': { left: 71.4, top: 67.8, width: 22.4, height: 3.5 },
  'budget-3': { left: 82.6, top: 73.6, width: 6.2, height: 2.8 },
  'budget-4': { left: 87.7, top: 73.6, width: 6.2, height: 2.8 },
  'wishlist-1': { left: 81.5, top: 91.5, width: 14.9, height: 6.9 },
  'wishlist-2': { left: 15.1, top: 54, width: 69.7, height: 5.5 },
  'wishlist-3': { left: 3.6, top: 24.9, width: 92.8, height: 37.6 },
  'wishlist-4': { left: 72.7, top: 26.5, width: 20.4, height: 4.5 },
  'rates-1': { left: 81.5, top: 91.5, width: 14.9, height: 6.9 },
  'rates-2': { left: 3.6, top: 42.9, width: 92.8, height: 13.2 },
  'rates-3': { left: 5.1, top: 62, width: 89.7, height: 8.1 },
  'rates-4': { left: 3.6, top: 18.9, width: 92.8, height: 20.5 },
  'settings-1': { left: 49.2, top: 30.4, width: 44.6, height: 5.5 },
  'settings-2': { left: 45.2, top: 35.9, width: 48.6, height: 5.5 },
  'settings-3': { left: 6.2, top: 46.6, width: 87.7, height: 7.6 },
  'settings-4': { left: 6.2, top: 53.3, width: 87.7, height: 8.3 },
  'settings-5': { left: 6.2, top: 70.5, width: 87.7, height: 7.5 },
  'trip-limit-1': { left: 6.2, top: 64.5, width: 87.7, height: 7.4 },
  'trip-limit-2': { left: 10.5, top: 88.7, width: 79, height: 5.5 },
}

export const STEP_RINGS_EN: Record<string, TutorialStepRing> = {
  'quickstart-5': { left: 4.6, top: 76.7, width: 90.8, height: 6.9 },
  'itinerary-1': { left: 3.6, top: 13.2, width: 59.2, height: 6 },
  'itinerary-3': { left: 3.6, top: 32.6, width: 92.8, height: 9.5 },
  'itinerary-4': { left: 5.1, top: 71.3, width: 46.6, height: 5.1 },
  'itinerary-5': { left: 86.7, top: 19.7, width: 11.8, height: 5.5 },
  'itinerary-6': { left: 75.4, top: 13.6, width: 11.3, height: 5.2 },
  'itinerary-7': { left: 3.6, top: 28.7, width: 54.4, height: 3.8 },
  'itinerary-8': { left: 3.6, top: 28.7, width: 92.8, height: 14 },
  'ledger-settle-1': { left: 42.8, top: 90.8, width: 14.4, height: 6.9 },
  'ledger-settle-2': { left: 5.1, top: 55.4, width: 89.7, height: 12.8 },
  'ledger-settle-3': { left: 9, top: 62.1, width: 82.1, height: 4.8 },
  'ledger-settle-4': { left: 5.1, top: 93.3, width: 89.7, height: 11 },
  'ledger-settle-5': { left: 5.1, top: 82.5, width: 89.7, height: 17.1 },
  'ledger-settle-6': { left: 3.6, top: 64.1, width: 92.8, height: 8.3 },
  'ledger-settle-7': { left: 10.8, top: 40.1, width: 78.5, height: 5 },
  'ledger-settle-8': { left: 3.6, top: 24.1, width: 92.8, height: 189.6 },
  'ledger-settle-9': { left: 78.7, top: 60.7, width: 13.3, height: 3.5 },
  'ledger-settle-10': { left: 3.6, top: 78.5, width: 92.8, height: 34.8 },
  'budget-1': { left: 6.2, top: 51.8, width: 87.7, height: 13.1 },
  'budget-2': { left: 55.9, top: 65.6, width: 38, height: 3.5 },
  'budget-3': { left: 82.6, top: 73.6, width: 6.2, height: 2.8 },
  'budget-4': { left: 87.7, top: 73.6, width: 6.2, height: 2.8 },
  'wishlist-1': { left: 81.5, top: 91.5, width: 14.9, height: 6.9 },
  'wishlist-2': { left: 15.1, top: 54.9, width: 69.7, height: 5.5 },
  'wishlist-3': { left: 3.6, top: 24.9, width: 92.8, height: 37.6 },
  'wishlist-4': { left: 70.6, top: 26.5, width: 22.5, height: 4.5 },
  'rates-1': { left: 81.5, top: 91.5, width: 14.9, height: 6.9 },
  'rates-2': { left: 3.6, top: 42.9, width: 92.8, height: 13.2 },
  'rates-3': { left: 5.1, top: 57.4, width: 89.7, height: 8.1 },
  'rates-4': { left: 3.6, top: 18.9, width: 92.8, height: 22.8 },
  'settings-1': { left: 49.1, top: 25.5, width: 44.8, height: 5.5 },
  'settings-2': { left: 46.9, top: 31, width: 47, height: 5.5 },
  'settings-3': { left: 6.2, top: 41.7, width: 87.7, height: 9.1 },
  'settings-4': { left: 6.2, top: 49.9, width: 87.7, height: 8.3 },
  'settings-5': { left: 6.2, top: 67.1, width: 87.7, height: 7.5 },
  'trip-limit-1': { left: 6.2, top: 61.2, width: 87.7, height: 7.4 },
  'trip-limit-2': { left: 10.5, top: 88.7, width: 79, height: 5.5 },
}

export function stepRing(stepId: string, lang: 'zh' | 'en'): TutorialStepRing | undefined {
  return (lang === 'en' ? STEP_RINGS_EN : STEP_RINGS_ZH)[stepId]
}

export function tutorialImage(stepId: string, lang: 'zh' | 'en'): string {
  return lang === 'en' ? `/tutorial-shots/${stepId}-en.png` : `/tutorial-shots/${stepId}.png`
}
