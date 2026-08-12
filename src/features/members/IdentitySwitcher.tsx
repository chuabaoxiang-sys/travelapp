import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { UserPlus, Check, Pencil, Trash2, Archive, ArchiveRestore, X } from 'lucide-react'
import { db } from '../../db/dexie'
import { Avatar } from '../../components/Avatar'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { createMember, renameMember, memberHasHistory, deleteMemberHard, deactivateMember, reactivateMember } from '../../domain/members'
import type { Member } from '../../types'

// 顶部标题栏常驻的身份指示器——点开直接弹出成员列表可以切换、编辑、停用/删除，或添加新成员，
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<{ member: Member; hasHistory: boolean } | null>(null)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)

  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const active = members.filter((m) => m.isActive)
  const inactive = members.filter((m) => !m.isActive)
  const current = active.find((m) => m.id === currentMemberId)

  async function handleAdd() {
    if (!newName.trim()) return
    const id = await createMember(newName)
    setNewName('')
    setAdding(false)
    onSelectMember(id)
    setOpen(false)
  }

  function startEdit(m: Member) {
    setEditingId(m.id)
    setEditName(m.displayName)
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return
    await renameMember(editingId, editName)
    setEditingId(null)
  }

  async function handleRemoveClick(m: Member) {
    if (m.id === currentMemberId) {
      setBlockedMessage('不能对当前使用的身份操作，先切换成别的家庭成员再试')
      return
    }
    const hasHistory = await memberHasHistory(m.id)
    setPendingRemove({ member: m, hasHistory })
  }

  async function confirmRemove() {
    if (!pendingRemove) return
    if (pendingRemove.hasHistory) {
      await deactivateMember(pendingRemove.member.id)
    } else {
      await deleteMemberHard(pendingRemove.member.id)
    }
    setPendingRemove(null)
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
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setAdding(false); setEditingId(null) }} />
          <div className="absolute left-0 top-full mt-1.5 w-[210px] rounded-xl border border-line bg-card shadow-lg z-50 overflow-hidden">
            {active.map((m) =>
              editingId === m.id ? (
                <div key={m.id} className="flex gap-1.5 p-2 border-b border-line">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                    autoFocus
                    className="flex-1 min-w-0 rounded-lg border border-plan bg-paper px-2 py-1 text-[12.5px] outline-none"
                  />
                  <button onClick={saveEdit} className="text-plan flex-shrink-0" title="保存">
                    <Check className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-muted flex-shrink-0" title="取消">
                    <X className="w-3.5 h-3.5" strokeWidth={1.8} />
                  </button>
                </div>
              ) : (
                <div key={m.id} className={`w-full flex items-center gap-0.5 pl-3 pr-1.5 ${m.id === currentMemberId ? 'bg-paper' : ''}`}>
                  <button
                    onClick={() => { onSelectMember(m.id); setOpen(false) }}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left text-[13px] py-2"
                  >
                    <Avatar member={m} size={22} />
                    <span className="truncate flex-1">{m.displayName}</span>
                    {m.id === currentMemberId && <Check className="w-3.5 h-3.5 text-plan flex-shrink-0" strokeWidth={2} />}
                  </button>
                  <button onClick={() => startEdit(m)} className="text-muted p-1.5 flex-shrink-0" title="编辑">
                    <Pencil className="w-3 h-3" strokeWidth={1.8} />
                  </button>
                  <button onClick={() => handleRemoveClick(m)} className="text-muted p-1.5 flex-shrink-0" title="删除">
                    <Trash2 className="w-3 h-3" strokeWidth={1.8} />
                  </button>
                </div>
              ),
            )}
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
                <button onClick={handleAdd} className="rounded-lg bg-plan text-card px-2.5 flex-shrink-0" title="添加">
                  <Check className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
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

            {inactive.length > 0 && (
              <>
                <button
                  onClick={() => setShowInactive((v) => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11.5px] text-muted border-t border-line"
                >
                  <Archive className="w-3 h-3" strokeWidth={1.8} />
                  {showInactive ? '收起已停用' : `已停用的成员（${inactive.length}）`}
                </button>
                {showInactive &&
                  inactive.map((m) => (
                    <div key={m.id} className="w-full flex items-center gap-2 pl-3 pr-2 py-1.5 opacity-60">
                      <Avatar member={m} size={20} />
                      <span className="truncate flex-1 text-[12.5px]">{m.displayName}</span>
                      <button onClick={() => reactivateMember(m.id)} className="text-plan flex-shrink-0" title="恢复">
                        <ArchiveRestore className="w-3 h-3" strokeWidth={1.8} />
                      </button>
                    </div>
                  ))}
              </>
            )}
          </div>
        </>
      )}

      {blockedMessage && (
        <ConfirmDialog
          title="没法这样操作"
          message={blockedMessage}
          confirmLabel="知道了"
          danger={false}
          onConfirm={() => setBlockedMessage(null)}
          onCancel={() => setBlockedMessage(null)}
        />
      )}

      {pendingRemove && (
        <ConfirmDialog
          title={pendingRemove.hasHistory ? `停用「${pendingRemove.member.displayName}」？` : `删除「${pendingRemove.member.displayName}」？`}
          message={
            pendingRemove.hasHistory
              ? '这个人已经有记账/分摊/结算记录，不能真的删除（会破坏历史账目）。改为停用：不会再出现在选身份/记账名单里，但过去的记录完全不受影响，随时可以在"已停用的成员"里恢复。'
              : '这个人还没有任何记账/结算记录，删除后无法恢复。'
          }
          confirmLabel={pendingRemove.hasHistory ? '停用' : '删除'}
          danger={!pendingRemove.hasHistory}
          onConfirm={confirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  )
}
