import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
vi.mock('../api/supabaseClient', () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }))

const {
  getHouseholdInviteCode,
  regenerateHouseholdInviteCode,
  joinHouseholdByInviteCode,
  createHousehold,
  setPendingInviteCode,
  clearPendingInviteCode,
  redeemPendingInviteCode,
} = await import('./household')

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
    // 0039之后绝对不能再把邮箱传给数据库——"替某个邮箱加入"正是冒名漏洞
    it('只传转大写、去空格的邀请码，不传任何邮箱', async () => {
      rpcMock.mockResolvedValue({ data: true, error: null })
      await joinHouseholdByInviteCode(' ab12cd ')
      expect(rpcMock).toHaveBeenCalledWith('join_household_by_invite_code', { p_code: 'AB12CD' })
    })

    it('成功加入时返回joined', async () => {
      rpcMock.mockResolvedValue({ data: true, error: null })
      expect(await joinHouseholdByInviteCode('CODE1')).toBe('joined')
    })

    it('邀请码错误（RPC返回false）时返回invalid', async () => {
      rpcMock.mockResolvedValue({ data: false, error: null })
      expect(await joinHouseholdByInviteCode('WRONG')).toBe('invalid')
    })

    // 网络抖动不能说成"邀请码无效"，码本身可能是对的
    it('RPC报错时返回error，而不是invalid，也不抛出异常', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: '出错了' } })
      expect(await joinHouseholdByInviteCode('CODE1')).toBe('error')
    })

    it('网络请求本身抛异常时返回error', async () => {
      rpcMock.mockRejectedValue(new Error('network down'))
      expect(await joinHouseholdByInviteCode('CODE1')).toBe('error')
    })
  })

  describe('登录页邀请码：先记着，本人登录后再加入', () => {
    beforeEach(() => {
      clearPendingInviteCode()
    })

    it('没有记过邀请码时什么都不做', async () => {
      expect(await redeemPendingInviteCode('a@b.com')).toBe('none')
      expect(rpcMock).not.toHaveBeenCalled()
    })

    it('填码时的邮箱登录后用这个码加入，码只用一次；邮箱大小写/空格不影响', async () => {
      rpcMock.mockResolvedValue({ data: true, error: null })
      setPendingInviteCode(' ab12cd ', '  Friend@Example.com ')
      expect(await redeemPendingInviteCode('friend@example.com')).toBe('joined')
      expect(rpcMock).toHaveBeenCalledWith('join_household_by_invite_code', { p_code: 'AB12CD' })
      expect(await redeemPendingInviteCode('friend@example.com')).toBe('none')
      expect(rpcMock).toHaveBeenCalledTimes(1)
    })

    // 共用设备：别人先填好自己团队的码，接着登录的是另一个人——绝对不能把后者拉进去
    it('实际登录的账号跟填码时的邮箱不一致，码作废、不调用加入', async () => {
      setPendingInviteCode('CODE1', 'someone@example.com')
      expect(await redeemPendingInviteCode('victim@example.com')).toBe('none')
      expect(rpcMock).not.toHaveBeenCalled()
      // 作废之后，就算原来那个邮箱后来登录也不会再用这个码
      expect(await redeemPendingInviteCode('someone@example.com')).toBe('none')
    })

    it('拿不到登录邮箱时不加入', async () => {
      setPendingInviteCode('CODE1', 'a@b.com')
      expect(await redeemPendingInviteCode(undefined)).toBe('none')
      expect(rpcMock).not.toHaveBeenCalled()
    })

    it('clearPendingInviteCode之后不再加入（改走普通登录/Google/换邮箱）', async () => {
      setPendingInviteCode('CODE1', 'a@b.com')
      clearPendingInviteCode()
      expect(await redeemPendingInviteCode('a@b.com')).toBe('none')
      expect(rpcMock).not.toHaveBeenCalled()
    })

    it('码不对返回invalid，网络出错返回error', async () => {
      rpcMock.mockResolvedValueOnce({ data: false, error: null })
      setPendingInviteCode('WRONG', 'a@b.com')
      expect(await redeemPendingInviteCode('a@b.com')).toBe('invalid')

      rpcMock.mockRejectedValueOnce(new Error('network down'))
      setPendingInviteCode('CODE1', 'a@b.com')
      expect(await redeemPendingInviteCode('a@b.com')).toBe('error')
    })

    // 同一次登录会连着触发好几个auth事件，都会调到这里——必须共用同一次加入，
    // 不能第二个调用拿到'none'之后抢先去查"当前团队"
    it('加入进行中再次调用，拿到的是同一个结果', async () => {
      let resolve: (v: { data: boolean; error: null }) => void = () => {}
      rpcMock.mockReturnValue(new Promise((r) => { resolve = r }))
      setPendingInviteCode('CODE1', 'a@b.com')
      const first = redeemPendingInviteCode('a@b.com')
      const second = redeemPendingInviteCode('a@b.com')
      resolve({ data: true, error: null })
      expect(await first).toBe('joined')
      expect(await second).toBe('joined')
      expect(rpcMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('createHousehold', () => {
    it('团队名去掉首尾空格后再传给RPC', async () => {
      rpcMock.mockResolvedValue({ data: 'new-household-id', error: null })
      await createHousehold('  我的新团队  ')
      expect(rpcMock).toHaveBeenCalledWith('create_household', { p_name: '我的新团队' })
    })

    it('成功时返回新团队id', async () => {
      rpcMock.mockResolvedValue({ data: 'new-household-id', error: null })
      expect(await createHousehold('新团队')).toBe('new-household-id')
    })

    // 跟上面几个"失败就吞成false/null"的函数刻意不同：开关关闭/名字为空/未登录
    // 这几种失败，数据库那边的报错文案是要给已登录用户直接看的，所以这里要抛出去，
    // 不能吞掉——调用方（NoHouseholdScreen）需要拿到真实的错误信息展示
    it('RPC报错时抛出异常，而不是吞掉返回null', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: '自助创建团队功能尚未开放，请联系开发者' } })
      await expect(createHousehold('新团队')).rejects.toMatchObject({
        message: '自助创建团队功能尚未开放，请联系开发者',
      })
    })
  })
})
