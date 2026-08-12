import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie'
import { Avatar } from '../../components/Avatar'
import { createMember } from '../../domain/members'

export function MemberGate({ onPicked }: { onPicked: (id: string) => void }) {
  const allMembers = useLiveQuery(() => db.members.toArray()) ?? []
  const list = allMembers.filter((m) => m.isActive)
  const [newName, setNewName] = useState('')

  async function addMember() {
    if (!newName.trim()) return
    const id = await createMember(newName)
    setNewName('')
    onPicked(id)
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-card rounded-3xl p-6 border border-line">
        <div className="text-[11px] tracking-widest text-muted uppercase">旅记 · TripJournal</div>
        <h1 className="font-serif-sc text-2xl mt-2 text-ink">你是谁？</h1>
        <p className="text-sm text-muted mt-1">选择你的名字，之后记的账都会算在这个身份下（暂不需要密码）</p>

        <div className="mt-5 flex flex-col gap-2">
          {list.map((m) => (
            <button
              key={m.id}
              onClick={() => onPicked(m.id)}
              className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3 text-left hover:border-plan transition-colors"
            >
              <Avatar member={m} size={32} />
              <span className="text-sm font-medium text-ink">{m.displayName}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addMember()}
            placeholder="添加新家庭成员"
            className="flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-plan"
          />
          <button
            onClick={addMember}
            className="rounded-xl bg-plan text-card px-4 py-2 text-sm font-medium"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}
