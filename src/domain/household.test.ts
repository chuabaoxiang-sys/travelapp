import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
vi.mock('../api/supabaseClient', () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }))

const { getHouseholdInviteCode, regenerateHouseholdInviteCode, joinHouseholdByInviteCode } = await import('./household')

// 这几个函数本身只是薄薄一层RPC调用包装——真正的邀请码生成/校验逻辑在
// supabase/migrations 里的数据库函数，现有测试基础设施没有pgTAP、没有本地/
// 容器化Postgres，也没有任何已建立的DB集成测试模式，SQL那一层没法在这里
// 真正测到。这里只测包装层本身：参数有没有正确处理（trim/大小写）、
// RPC报错时有没有被正确吞掉转成null/false，而不是让异常往外抛
describe('household 邀请码客户端包装函数（真实的SQL函数逻辑无法在这套测试基础设施下覆盖）', () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  describe('getHouseholdInviteCode', () => {
    it('成功时原样返回邀请码', async () => {
      rpcMock.mockResolvedValue({ data: 'ABC123', error: null })
      expect(await getHouseholdInviteCode()).toBe('ABC123')
      expect(rpcMock).toHaveBeenCalledWith('get_household_invite_code')
    })

    it('RPC报错时返回null，而不是抛出异常', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: '出错了' } })
      expect(await getHouseholdInviteCode()).toBeNull()
    })
  })

  describe('regenerateHouseholdInviteCode', () => {
    it('成功时返回新邀请码', async () => {
      rpcMock.mockResolvedValue({ data: 'NEWCODE', error: null })
      expect(await regenerateHouseholdInviteCode()).toBe('NEWCODE')
      expect(rpcMock).toHaveBeenCalledWith('regenerate_household_invite_code')
    })

    it('RPC报错时返回null', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: '出错了' } })
      expect(await regenerateHouseholdInviteCode()).toBeNull()
    })
  })

  describe('joinHouseholdByInviteCode', () => {
    it('邮箱去掉首尾空格、邀请码转大写去空格后再传给RPC', async () => {
      rpcMock.mockResolvedValue({ data: true, error: null })
      await joinHouseholdByInviteCode('  test@example.com  ', ' ab12cd ')
      expect(rpcMock).toHaveBeenCalledWith('join_household_by_invite_code', {
        p_email: 'test@example.com',
        p_code: 'AB12CD',
      })
    })

    it('成功加入时返回true', async () => {
      rpcMock.mockResolvedValue({ data: true, error: null })
      expect(await joinHouseholdByInviteCode('a@b.com', 'CODE1')).toBe(true)
    })

    it('邀请码错误（RPC返回false）时返回false', async () => {
      rpcMock.mockResolvedValue({ data: false, error: null })
      expect(await joinHouseholdByInviteCode('a@b.com', 'WRONG')).toBe(false)
    })

    it('RPC报错时返回false，而不是抛出异常', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: '出错了' } })
      expect(await joinHouseholdByInviteCode('a@b.com', 'CODE1')).toBe(false)
    })
  })
})
