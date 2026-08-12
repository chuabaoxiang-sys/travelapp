import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { UserPlus } from 'lucide-react'
import { db } from '../../db/dexie'
import { assembleExportBundle } from '../../domain/export'
import { buildExcelFile, buildJsonFile, buildCsvFile } from '../../domain/exportRenderers'
import { createMember } from '../../domain/members'
import { shareOrDownloadFile } from '../../lib/share'
import { Avatar } from '../../components/Avatar'
import type { Trip } from '../../types'

type ExportKind = 'excel' | 'json' | 'csv'

const EXPORT_OPTIONS: { kind: ExportKind; title: string; desc: string; icon: ReactNode }[] = [
  {
    kind: 'excel',
    title: '导出 Excel',
    desc: '明细 + 汇总两个sheet，行程和账目都在里面',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h3M13 12h3M8 16h3M13 16h3" />
      </svg>
    ),
  },
  {
    kind: 'json',
    title: '导出 JSON',
    desc: '给AI工具生成游记文案/短视频脚本用',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5" />
      </svg>
    ),
  },
  {
    kind: 'csv',
    title: '导出 CSV',
    desc: '摊平成表格，方便导入其他工具',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    ),
  },
]

export function TripMoreSheet({
  trip,
  currentMemberId,
  onClose,
  onOpenFeedback,
  onSwitchMember,
}: {
  trip: Trip
  currentMemberId: string
  onClose: () => void
  onOpenFeedback: () => void
  onSwitchMember: () => void
}) {
  const currentMember = useLiveQuery(() => db.members.get(currentMemberId), [currentMemberId])
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addingMember, setAddingMember] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')

  async function handleAddMember() {
    if (!newMemberName.trim()) return
    await createMember(newMemberName)
    setNewMemberName('')
    setAddingMember(false)
  }

  async function handleExport(kind: ExportKind) {
    setError(null)
    setBusy(kind)
    try {
      const bundle = await assembleExportBundle(trip.id)
      const file =
        kind === 'excel' ? buildExcelFile(bundle) : kind === 'json' ? buildJsonFile(bundle) : buildCsvFile(bundle)
      await shareOrDownloadFile(file, `${trip.name} · 旅记导出`)
    } catch {
      setError('导出失败，请重试')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="flex-1 bg-ink/35" onClick={onClose} />
      <div className="bg-paper rounded-t-[26px] px-5 pt-3.5 pb-7 shadow-[0_-10px_40px_rgba(31,27,22,0.2)]">
        <div className="w-[38px] h-1 rounded-full bg-[#D8CFC0] mx-auto mb-3.5" />

        <div className="flex items-center justify-between py-1.5 border-b border-line mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar member={currentMember} size={26} />
            <div className="text-[13px] min-w-0 truncate">
              当前身份：<span className="font-medium">{currentMember?.displayName ?? '…'}</span>
            </div>
          </div>
          <button onClick={onSwitchMember} className="text-[11.5px] text-plan flex-shrink-0 pl-2">切换身份</button>
        </div>

        {addingMember ? (
          <div className="flex gap-2 py-1.5 border-b border-line mb-1.5">
            <input
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
              placeholder="家庭成员姓名"
              autoFocus
              className="flex-1 min-w-0 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-plan"
            />
            <button onClick={handleAddMember} className="rounded-lg bg-plan text-card px-3 text-[12.5px] font-medium flex-shrink-0">添加</button>
            <button onClick={() => { setAddingMember(false); setNewMemberName('') }} className="text-[12.5px] text-muted flex-shrink-0">取消</button>
          </div>
        ) : (
          <button
            onClick={() => setAddingMember(true)}
            className="w-full flex items-center gap-2 py-1.5 border-b border-line mb-1.5 text-[12.5px] text-plan"
          >
            <UserPlus className="w-[15px] h-[15px]" strokeWidth={1.8} />
            添加家庭成员
          </button>
        )}

        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-semibold">导出与分享</span>
          <button onClick={onClose} className="text-[12.5px] text-muted">关闭</button>
        </div>

        <div className="flex flex-col">
          {EXPORT_OPTIONS.map((opt) => (
            <button
              key={opt.kind}
              onClick={() => handleExport(opt.kind)}
              disabled={busy !== null}
              className="flex items-center gap-3 py-2.5 border-t border-line first:border-t-0 first:mt-1.5 text-left disabled:opacity-50"
            >
              <span className="w-[34px] h-[34px] rounded-[10px] bg-card border border-line flex items-center justify-center text-plan flex-shrink-0 [&_svg]:w-[17px] [&_svg]:h-[17px]">
                {opt.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">{opt.title}</div>
                <div className="text-[10.5px] text-muted mt-0.5">{opt.desc}</div>
              </div>
              <span className="text-[11.5px] text-plan flex-shrink-0">
                {busy === opt.kind ? '生成中…' : '分享 ›'}
              </span>
            </button>
          ))}
        </div>

        {error && <div className="text-[11.5px] text-negative mt-2">{error}</div>}

        <button
          onClick={onOpenFeedback}
          className="w-full flex items-center gap-3 py-2.5 mt-2 border-t border-line text-left"
        >
          <span className="w-[34px] h-[34px] rounded-[10px] bg-card border border-line flex items-center justify-center text-plan flex-shrink-0">
            <svg viewBox="0 0 24 24" className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">提交反馈</div>
            <div className="text-[10.5px] text-muted mt-0.5">用得不顺手的地方、想加的功能，都可以说</div>
          </div>
          <span className="text-[11.5px] text-plan flex-shrink-0">去反馈 ›</span>
        </button>
      </div>
    </div>
  )
}
