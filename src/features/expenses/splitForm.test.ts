import { describe, it, expect } from 'vitest'
import { initialSplitMemberIds, splitMemberIdsForSave, splitTypeForSave } from './splitForm'
import { buildSplitShares } from '../../domain/splits'

// 2026-11-08 账目检查：编辑「个人开销」的账，保存后变成「大家分摊（只有付款人）」；
// 编辑时改了付款人，原付款人会变成欠新付款人全额
describe('编辑个人开销', () => {
  it('打开编辑页时名单是空的，不把"付款人自己"那一条分摊行读进来', () => {
    expect(initialSplitMemberIds('none', ['bx'])).toEqual([])
  })

  it('不改什么直接保存：还是个人开销，分摊行只有付款人自己', () => {
    const ids = initialSplitMemberIds('none', ['bx'])
    expect(splitTypeForSave('personal', ids, false)).toBe('none')
    expect(buildSplitShares(100, splitTypeForSave('personal', ids, false), splitMemberIdsForSave('personal', ids), 'bx'))
      .toEqual([{ memberId: 'bx', shareAmount: 100 }])
  })

  it('编辑时把付款人从 BX 改成 KN：还是 KN 自己的开销，BX 不欠任何钱', () => {
    const ids = initialSplitMemberIds('none', ['bx'])
    const shares = buildSplitShares(225.34, splitTypeForSave('personal', ids, false), splitMemberIdsForSave('personal', ids), 'kn')
    expect(shares).toEqual([{ memberId: 'kn', shareAmount: 225.34 }])
  })

  it('就算名单里残留了人，选的是「个人开销」页签也存成个人开销', () => {
    expect(splitTypeForSave('personal', ['bx'], false)).toBe('none')
    expect(splitMemberIdsForSave('personal', ['bx'])).toEqual([])
  })
})

describe('其他分摊方式不受影响', () => {
  it('大家分摊：读进已有名单（去重），按人数判断平分/自定义', () => {
    expect(initialSplitMemberIds('equal', ['bx', 'kn', 'kn'])).toEqual(['bx', 'kn'])
    expect(splitTypeForSave('share', ['bx', 'kn'], false)).toBe('equal')
    expect(splitTypeForSave('share', ['bx', 'kn'], true)).toBe('exact')
  })

  it('大家分摊只勾 1 个非付款人（BX 帮 KN 垫付）：还是 equal，KN 欠全额', () => {
    expect(splitTypeForSave('share', ['kn'], false)).toBe('equal')
    expect(splitMemberIdsForSave('share', ['kn'])).toEqual(['kn'])
  })

  it('大家分摊把人全取消勾选：当成个人开销', () => {
    expect(splitTypeForSave('share', [], false)).toBe('none')
  })

  it('逐项拆账', () => {
    expect(splitTypeForSave('itemized', [], false)).toBe('itemized')
  })
})
