import type { SplitType } from '../../types'

export type SplitFormMode = 'share' | 'itemized' | 'personal'

// 编辑页打开时，「大家分摊」名单从哪里开始。
// 个人开销在数据库里也有一条"付款人自己"的分摊行（buildSplitShares 对 'none'
// 就是这么存的），但它不是"勾了付款人一个人"——如果把这一行读进名单，保存时
// 名单有 1 人就会被存成「大家分摊（只有我）」；改了付款人的话，原付款人还会
// 变成欠新付款人全额（2026-11-08 账目检查发现）。所以个人开销一律从空名单开始
export function initialSplitMemberIds(splitType: SplitType, existingMemberIds: string[]): string[] {
  if (splitType === 'none') return []
  return [...new Set(existingMemberIds)]
}

// 保存时这笔算哪种分摊：以当前选的页签为准，不靠名单人数去猜
export function splitTypeForSave(mode: SplitFormMode, splitMemberIds: string[], usingExactSplit: boolean): SplitType {
  if (mode === 'itemized') return 'itemized'
  if (mode === 'personal' || splitMemberIds.length === 0) return 'none'
  return usingExactSplit ? 'exact' : 'equal'
}

// 保存时传给 saveExpenseSplits 的名单：个人开销不带任何人，分摊行按付款人重新生成
export function splitMemberIdsForSave(mode: SplitFormMode, splitMemberIds: string[]): string[] {
  return mode === 'personal' ? [] : splitMemberIds
}
