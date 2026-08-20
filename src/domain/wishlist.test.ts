import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createWishlistPlace,
  updateWishlistPlace,
  toggleWishlistVisited,
  deleteWishlistPlace,
  usageByWishlistEntry,
  nearbyWishlistSuggestions,
} from './wishlist'
import { db } from '../db/dexie'
import type { Trip, ItineraryItem } from '../types'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1' }))

function trip(id: string, name: string): Trip {
  return {
    id, householdId: 'h1', name, homeCurrency: 'MYR', startDate: null, endDate: null,
    status: 'planning', publicShareScope: 'none', publicShareToken: null, publicShareTemplate: null,
    createdAt: 0, updatedAt: 0,
  }
}

function itineraryItem(id: string, tripId: string, sourceWishlistId: string | null): ItineraryItem {
  return {
    id, householdId: 'h1', dayId: 'day-1', tripId, orderIndex: 0, time: null, title: '某个行程项',
    locationName: null, lat: null, lng: null, notes: null, createdBy: null, sourceWishlistId,
    createdAt: 0, updatedAt: 0,
  }
}

describe('createWishlistPlace / updateWishlistPlace / toggleWishlistVisited / deleteWishlistPlace（真实走Dexie）', () => {
  beforeEach(async () => {
    await db.wishlistPlaces.clear()
  })

  it('新增时 visited 默认是 false，不需要调用方显式传', async () => {
    const p = await createWishlistPlace({ name: '一兰拉面', lat: 35.1, lng: 139.7, notes: null, createdBy: 'papa' })
    expect(p.visited).toBe(false)
    expect(p.householdId).toBe('h1')
  })

  it('更新只改名字/坐标/备注，不动 visited/createdAt', async () => {
    const p = await createWishlistPlace({ name: '旧名字', lat: null, lng: null, notes: null, createdBy: 'papa' })
    await toggleWishlistVisited(p.id, true)
    await updateWishlistPlace(p.id, { name: '新名字', lat: 1, lng: 2, notes: '备注' })
    const updated = await db.wishlistPlaces.get(p.id)
    expect(updated?.name).toBe('新名字')
    expect(updated?.lat).toBe(1)
    expect(updated?.notes).toBe('备注')
    expect(updated?.visited).toBe(true) // 编辑地点信息不应该把"去过了"的标记冲掉
  })

  it('toggleWishlistVisited 独立于其他字段，能来回切换', async () => {
    const p = await createWishlistPlace({ name: 'x', lat: null, lng: null, notes: null, createdBy: null })
    await toggleWishlistVisited(p.id, true)
    expect((await db.wishlistPlaces.get(p.id))?.visited).toBe(true)
    await toggleWishlistVisited(p.id, false)
    expect((await db.wishlistPlaces.get(p.id))?.visited).toBe(false)
  })

  it('删除是硬删除，之后查不到这一行', async () => {
    const p = await createWishlistPlace({ name: 'x', lat: null, lng: null, notes: null, createdBy: null })
    await deleteWishlistPlace(p.id)
    expect(await db.wishlistPlaces.get(p.id)).toBeUndefined()
  })
})

describe('usageByWishlistEntry（真实走Dexie）', () => {
  beforeEach(async () => {
    await db.itineraryItems.clear()
    await db.trips.clear()
  })

  it('没有任何行程项引用过的条目，不出现在返回的Map里', async () => {
    const usage = await usageByWishlistEntry()
    expect(usage.has('never-used')).toBe(false)
  })

  it('一个行程项引用时，正确返回它所在行程的名字', async () => {
    await db.trips.add(trip('t1', '东京5日家族游'))
    await db.itineraryItems.add(itineraryItem('i1', 't1', 'w1'))
    const usage = await usageByWishlistEntry()
    expect(usage.get('w1')).toEqual({ tripNames: ['东京5日家族游'] })
  })

  it('跨两趟不同行程引用同一条时，两个行程名都在、去重', async () => {
    await db.trips.bulkAdd([trip('t1', '东京5日家族游'), trip('t2', '大阪周末游')])
    await db.itineraryItems.bulkAdd([
      itineraryItem('i1', 't1', 'w1'),
      itineraryItem('i2', 't2', 'w1'),
      itineraryItem('i3', 't1', 'w1'), // 同一趟行程里第二次引用，不应该让行程名重复出现
    ])
    const usage = await usageByWishlistEntry()
    expect(usage.get('w1')?.tripNames.sort()).toEqual(['东京5日家族游', '大阪周末游'])
  })

  it('没有 sourceWishlistId 的行程项不计入任何条目', async () => {
    await db.trips.add(trip('t1', '东京5日家族游'))
    await db.itineraryItems.add(itineraryItem('i1', 't1', null))
    const usage = await usageByWishlistEntry()
    expect(usage.size).toBe(0)
  })

  it('现查现算——引用它的行程项被删掉之后，这条从Map里消失', async () => {
    await db.trips.add(trip('t1', '东京5日家族游'))
    await db.itineraryItems.add(itineraryItem('i1', 't1', 'w1'))
    expect((await usageByWishlistEntry()).has('w1')).toBe(true)
    await db.itineraryItems.delete('i1')
    expect((await usageByWishlistEntry()).has('w1')).toBe(false)
  })
})

describe('nearbyWishlistSuggestions', () => {
  function place(id: string, lat: number | null, lng: number | null) {
    return { id, householdId: 'h1', name: id, lat, lng, notes: null, visited: false, createdBy: null, createdAt: 0, updatedAt: 0 }
  }

  it('当前这一天一个行程项都还没排时，返回空数组（没有锚点可比），即使整趟行程别的天有点', () => {
    const otherDayItem = itineraryItem('i1', 't1', null)
    otherDayItem.lat = 35.68
    otherDayItem.lng = 139.77
    const result = nearbyWishlistSuggestions([place('p1', 35.7, 139.7)], [], [otherDayItem])
    expect(result).toEqual([])
  })

  it('离当前这一天的行程项足够近的地点会被推荐', () => {
    // 东京市中心附近，相距几公里
    const dayItems = [itineraryItem('i1', 't1', null)]
    dayItems[0].lat = 35.68
    dayItems[0].lng = 139.77
    const nearby = place('p-near', 35.71, 139.8) // 大约4公里
    const result = nearbyWishlistSuggestions([nearby], dayItems, dayItems)
    expect(result.map((p) => p.id)).toEqual(['p-near'])
  })

  it('离得太远的地点不会被推荐（比如另一个国家）', () => {
    const dayItems = [itineraryItem('i1', 't1', null)]
    dayItems[0].lat = 35.68
    dayItems[0].lng = 139.77
    const far = place('p-far', 3.14, 101.69) // 吉隆坡，几千公里外
    const result = nearbyWishlistSuggestions([far], dayItems, dayItems)
    expect(result).toEqual([])
  })

  it('没有坐标的地点不推荐，即使离得很"近"（无法判断）', () => {
    const dayItems = [itineraryItem('i1', 't1', null)]
    dayItems[0].lat = 35.68
    dayItems[0].lng = 139.77
    const noCoords = place('p-no-coords', null, null)
    expect(nearbyWishlistSuggestions([noCoords], dayItems, dayItems)).toEqual([])
  })

  it('已经跟这趟行程关联过（sourceWishlistId对应）的地点不重复推荐', () => {
    const anchorNear = itineraryItem('i1', 't1', null)
    anchorNear.lat = 35.68
    anchorNear.lng = 139.77
    const alreadyLinked = itineraryItem('i2', 't1', 'p-near')
    alreadyLinked.lat = 35.68
    alreadyLinked.lng = 139.77
    const nearby = place('p-near', 35.71, 139.8)
    const result = nearbyWishlistSuggestions([nearby], [anchorNear, alreadyLinked], [anchorNear, alreadyLinked])
    expect(result).toEqual([])
  })

  it('跨城市行程：只看当前这一天的锚点，别的天离得近也不会跨天推荐过来（核心修复点）', () => {
    // 东京那几天的行程项
    const tokyoItem = itineraryItem('tokyo-item', 't1', null)
    tokyoItem.lat = 35.68
    tokyoItem.lng = 139.77
    // 北海道那几天的行程项——跟东京隔了800多公里
    const hokkaidoItem = itineraryItem('hokkaido-item', 't1', null)
    hokkaidoItem.lat = 43.06
    hokkaidoItem.lng = 141.35

    const tokyoPlace = place('p-tokyo', 35.71, 139.8) // 靠近东京行程项
    const allTripItems = [tokyoItem, hokkaidoItem]

    // 当前正在看北海道那一天：只传北海道的行程项当锚点，东京附近的地点不该被推荐
    expect(nearbyWishlistSuggestions([tokyoPlace], [hokkaidoItem], allTripItems)).toEqual([])
    // 当前正在看东京那一天：传东京的行程项当锚点，才会推荐出来
    expect(nearbyWishlistSuggestions([tokyoPlace], [tokyoItem], allTripItems).map((p) => p.id)).toEqual(['p-tokyo'])
  })

  it('已经排进"别的天"的地点，看这一天时也不该重复推荐（排除逻辑要看整趟行程，不能只看当前这天）', () => {
    // 这个地点已经通过"另一天"的行程项排进了行程（sourceWishlistId对应），
    // 但当前这一天自己的行程项也离它很近——排除逻辑必须用整趟行程判断，才能正确跳过
    const otherDayLinkedItem = itineraryItem('other-day-item', 't1', 'p-already-used')
    otherDayLinkedItem.lat = 35.68
    otherDayLinkedItem.lng = 139.77
    const currentDayItem = itineraryItem('current-day-item', 't1', null)
    currentDayItem.lat = 35.69
    currentDayItem.lng = 139.78

    const usedPlace = place('p-already-used', 35.71, 139.8)
    const result = nearbyWishlistSuggestions([usedPlace], [currentDayItem], [otherDayLinkedItem, currentDayItem])
    expect(result).toEqual([])
  })
})
