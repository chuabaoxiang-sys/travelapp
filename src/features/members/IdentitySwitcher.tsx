import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { UserPlus, Check } from 'lucide-react'
import { db } from '../../db/dexie'
import { Avatar } from '../../components/Avatar'
import { createMember } from '../../domain/members'

// 顶部标题栏常驻的身份指示器——点开直接弹出成员列表可以切换，或添加新成员，
// 不用先钻进"更多"菜单才知道自己是谁
export function IdentitySwitcher({
  currentMemberId,
  onSelectMember,
}: {
  currentMemberId: string
  onSelectMember: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const active = members.filter((m) => m.isActive)
  const current = active.find((m) => m.id === currentMemberId)

  async function handleAdd() {
    if (!newName.trim()) return
    const id = await createMember(newName)
    setNewName('')
    setAdding(false)
    onSelectMember(id)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] text-ink"
      >
        <Avatar member={current} size={20} />
        <span className="max-w-[70px] truncate font-medium">{current?.displayName ?? '…'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setAdding(false) }} />
          <div className="absolute left-0 top-full mt-1.5 w-[190px] rounded-xl border border-line bg-card shadow-lg z-50 overflow-hidden">
            {active.map((m) => (
              <button
                key={m.id}
                onClick={() => { onSelectMember(m.id); setOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] ${m.id === currentMemberId ? 'bg-paper' : ''}`}
              >
                <Avatar member={m} size={22} />
                <span className="truncate flex-1">{m.displayName}</span>
                {m.id === currentMemberId && <Check className="w-3.5 h-3.5 text-plan flex-shrink-0" strokeWidth={2} />}
              </button>
            ))}
            <div className="border-t border-line" />
            {adding ? (
              <div className="p-2 flex gap-1.5">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder="姓名"
                  autoFocus
                  className="flex-1 min-w-0 rounded-lg border border-line bg-paper px-2 py-1 text-[12.5px] outline-none focus:border-plan"
                />
                <button onClick={handleAdd} className="rounded-lg bg-plan text-card px-2.5 text-[12px] flex-shrink-0">添加</button>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] text-plan"
              >
                <UserPlus className="w-[14px] h-[14px]" strokeWidth={1.8} />
                添加家庭成员
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
