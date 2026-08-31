import { useState } from 'react'
import { Users } from 'lucide-react'
import { createHousehold, signOut } from '../../domain/household'

export function NoHouseholdScreen({
  onHouseholdCreated,
  onSignOut,
}: {
  onHouseholdCreated: (id: string) => void
  onSignOut: () => void
}) {
  // 是否展开"创建团队"表单——跟EmailLogin.tsx的"有邀请码？点这里输入"同一个
  // 低调展开链接的视觉语言，不抢眼、不暗示这是"主路径"
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const id = await createHousehold(name)
      onHouseholdCreated(id)
    } catch {
      // create_household这个RPC自己会抛出面向用户的报错文案（开关未开/名字为空/
      // 未登录），但跨语言/跨环境的具体报错格式不保证稳定，这里统一显示一句通用
      // 提示，不直接把err.message糊给用户
      setError('创建失败，可能是这个功能还没开放，也可能是网络问题，稍后再试试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-card rounded-3xl p-6 border border-line">
        <div className="text-[11px] tracking-widest text-muted uppercase">旅记 · TripJournal</div>
        <h1 className="font-serif-sc text-xl mt-2 text-ink">这个邮箱还没加入团队</h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          可以换一个邮箱重新登录，或者不等被邀请，直接自己建一个新团队。
        </p>

        <div className="mt-4 pt-3 border-t border-line flex flex-col gap-1">
          <button onClick={() => signOut().then(onSignOut)} className="text-[12.5px] text-plan text-left">
            换个邮箱重新登录
          </button>

          {creating ? (
            <div className="mt-2 pt-1 flex flex-col gap-2.5">
              <p className="text-[12px] text-muted">给团队起个名字（比如"陈家旅行团"），建好之后你就是里面第一个成员。</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="团队名"
                autoFocus
                className="rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none focus:border-plan"
              />
              <button
                onClick={handleCreate}
                disabled={busy || !name.trim()}
                className="rounded-xl bg-plan text-card py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <Users className="w-4 h-4" strokeWidth={1.8} />
                {busy ? '创建中…' : '创建团队'}
              </button>
              {error && <div className="text-[12px] text-negative">{error}</div>}
            </div>
          ) : (
            <button onClick={() => setCreating(true)} className="text-[12.5px] text-plan text-left">
              或者，创建一个新团队
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
