import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, Check, Pencil, Trash2 } from 'lucide-react'
import { db } from '../../db/dexie'
import { getAllFeedback, createFeedback, updateFeedback, deleteFeedback } from '../../domain/feedback'
import { Avatar } from '../../components/Avatar'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { FeedbackCategory, Feedback } from '../../types'

const CATEGORIES: { value: FeedbackCategory; label: string; color: string }[] = [
  { value: 'bug', label: '问题反馈', color: 'var(--color-negative)' },
  { value: 'suggestion', label: '功能建议', color: 'var(--color-plan)' },
  { value: 'other', label: '其他', color: 'var(--color-soft)' },
]

function categoryMeta(value: FeedbackCategory) {
  return CATEGORIES.find((c) => c.value === value) ?? CATEGORIES[2]
}

export function FeedbackSheet({
  tripId,
  currentMemberId,
  onClose,
}: {
  tripId: string
  currentMemberId: string
  onClose: () => void
}) {
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const feedbackList = useLiveQuery(() => getAllFeedback()) ?? []

  const [category, setCategory] = useState<FeedbackCategory>('suggestion')
  const [content, setContent] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCategory, setEditCategory] = useState<FeedbackCategory>('suggestion')
  const [editContent, setEditContent] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // 嵌套的 ConfirmDialog 打开时暂停这里自己的Escape监听，避免一键关掉两层弹层
  useEscapeKey(!confirmDeleteId, onClose)

  function memberName(id: string) {
    return members.find((m) => m.id === id)?.displayName ?? '未知'
  }
  function memberOf(id: string) {
    return members.find((m) => m.id === id)
  }

  async function submit() {
    if (!content.trim()) return
    await createFeedback({ tripId, submittedBy: currentMemberId, category, content: content.trim() })
    setContent('')
    setCategory('suggestion')
  }

  function startEdit(f: Feedback) {
    setEditingId(f.id)
    setEditCategory(f.category)
    setEditContent(f.content)
  }

  async function saveEdit() {
    if (!editingId || !editContent.trim()) return
    await updateFeedback(editingId, { category: editCategory, content: editContent.trim() })
    setEditingId(null)
  }

  return (
    <div className="absolute inset-0 z-30 bg-scrim/35" onClick={onClose}>
      <div className="absolute inset-0 flex flex-col justify-end px-2.5 pb-2.5 pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto bg-paper rounded-[26px] px-5 pt-3.5 pb-7 shadow-[0_-6px_28px_rgba(31,27,22,0.22)] max-h-[88%] overflow-y-auto no-scrollbar"
        >
        <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-3.5" />
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-semibold">反馈</span>
          <button onClick={onClose} className="text-muted" title="关闭">
            <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
        </div>

        <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1">这属于</div>
        <div className="flex gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className="flex-1 rounded-[11px] py-2 text-[12.5px] border"
              style={
                category === c.value
                  ? { borderColor: c.color, background: `color-mix(in srgb, ${c.color} 11%, var(--color-card))`, color: c.color, fontWeight: 600 }
                  : { background: 'var(--color-card)', borderColor: 'var(--color-line)', color: 'var(--color-soft)' }
              }
            >
              {c.label}
            </button>
          ))}
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="想到什么就写下来——用得不顺手的地方、希望APP能加的功能，都可以"
          rows={3}
          className="w-full mt-2.5 rounded-xl border border-line bg-card px-3 py-2.5 text-sm outline-none focus:border-plan resize-none"
        />
        <button
          onClick={submit}
          disabled={!content.trim()}
          className="w-full mt-2 rounded-xl bg-plan text-card py-2.5 text-sm font-medium disabled:opacity-40"
        >
          提交反馈
        </button>

        {feedbackList.length > 0 && (
          <>
            <div className="text-[10.5px] tracking-widest uppercase text-muted mt-5 mb-1">反馈记录 · 共{feedbackList.length}条</div>
            <div className="flex flex-col">
              {feedbackList.map((f) => {
                const meta = categoryMeta(f.category)
                const isEditing = editingId === f.id
                return (
                  <div key={f.id} className="py-2.5 border-t border-line first:border-t-0">
                    {isEditing ? (
                      <div className="p-3 rounded-xl bg-card border border-line flex flex-col gap-2">
                        <div className="flex gap-1.5">
                          {CATEGORIES.map((c) => (
                            <button
                              key={c.value}
                              type="button"
                              onClick={() => setEditCategory(c.value)}
                              className="flex-1 rounded-lg py-1.5 text-[11.5px] border"
                              style={
                                editCategory === c.value
                                  ? { borderColor: c.color, background: `color-mix(in srgb, ${c.color} 11%, var(--color-card))`, color: c.color, fontWeight: 600 }
                                  : { background: 'var(--color-card)', borderColor: 'var(--color-line)', color: 'var(--color-soft)' }
                              }
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-[13px] outline-none focus:border-plan resize-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border border-line py-2 text-muted flex items-center justify-center" title="取消">
                            <X className="w-4 h-4" strokeWidth={1.8} />
                          </button>
                          <button onClick={saveEdit} disabled={!editContent.trim()} className="flex-1 rounded-lg bg-plan text-card py-2 disabled:opacity-40 flex items-center justify-center" title="保存">
                            <Check className="w-4 h-4" strokeWidth={2} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2.5">
                        <Avatar member={memberOf(f.submittedBy)} size={24} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12.5px] font-medium">{memberName(f.submittedBy)}</span>
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ background: `color-mix(in srgb, ${meta.color} 12%, transparent)`, color: meta.color }}
                            >
                              {meta.label}
                            </span>
                          </div>
                          <div className="text-[13px] mt-1 whitespace-pre-wrap break-words">{f.content}</div>
                          <div className="text-[10.5px] text-muted mt-1 tabular">
                            {new Date(f.createdAt).toLocaleDateString('zh-CN')}
                            {f.appVersion && ` · 版本 ${f.appVersion}`}
                          </div>
                        </div>
                        <button onClick={() => startEdit(f)} className="w-6 h-6 rounded-lg border border-line bg-card flex items-center justify-center text-muted flex-shrink-0" title="编辑">
                          <Pencil className="w-3 h-3" strokeWidth={1.8} />
                        </button>
                        <button onClick={() => setConfirmDeleteId(f.id)} className="w-6 h-6 rounded-lg border border-line bg-card flex items-center justify-center text-muted flex-shrink-0" title="删除">
                          <Trash2 className="w-3 h-3" strokeWidth={1.8} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
        </div>
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="删除这条反馈？"
          message="删除后无法恢复。"
          onConfirm={() => { deleteFeedback(confirmDeleteId); setConfirmDeleteId(null) }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  )
}
