import { useEffect, useState } from 'react'
import { X, Copy, RefreshCw } from 'lucide-react'
import { getHouseholdInviteCode, regenerateHouseholdInviteCode } from '../../domain/household'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useEscapeKey } from '../../hooks/useEscapeKey'

// 给团队里的现有成员看/复制/重新生成自己团队的邀请码——想邀请家人朋友加入，
// 把这串码发给对方即可，不用再找开发者手动跑SQL
export function InviteCodeSheet({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false)

  useEscapeKey(!confirmingRegenerate, onClose)

  useEffect(() => {
    getHouseholdInviteCode().then(setCode)
  }, [])

  async function copyCode() {
    if (!code) return
    // 之前只复制裸码，朋友收到一串字母数字不知道该干什么——现在带上说明文案和入口步骤，
    // 复制出去就是一条能直接发给对方的完整消息。图文教程（public/join-guide.html，
    // Vite原样发布成静态页）额外给一条链接，卡在哪一步都能照着截图对一遍
    const message = `邀请你加入"旅记"——我们家用来记行程和账目的小工具\n打开 ${window.location.origin}\n点"有邀请码？点这里输入"，填你的邮箱 + 下面这串邀请码就能加入：\n\n${code}\n\n（一步步图文教程：${window.location.origin}/join-guide.html）`
    await navigator.clipboard.writeText(message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function confirmRegenerate() {
    const next = await regenerateHouseholdInviteCode()
    setCode(next)
    setConfirmingRegenerate(false)
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="flex-1 bg-ink/35" onClick={onClose} />
      <div className="bg-paper rounded-t-[26px] px-5 pt-3.5 pb-7 shadow-[0_-10px_40px_rgba(31,27,22,0.2)] max-h-[88%] overflow-y-auto no-scrollbar">
        <div className="w-[38px] h-1 rounded-full bg-[#D8CFC0] mx-auto mb-3.5" />
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-semibold">邀请新成员</span>
          <button onClick={onClose} className="text-muted" title="关闭">
            <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
        </div>
        <div className="text-[11.5px] text-muted leading-relaxed mb-4">
          把下面这串邀请码发给想邀请的家人朋友，对方在登录页输入自己的邮箱 + 这串码，就能自己加入你的团队，不用再找我们手动开通。
        </div>

        {code === undefined && <div className="text-[12px] text-muted text-center py-4">加载中…</div>}
        {code === null && <div className="text-[12px] text-negative text-center py-4">拿不到邀请码，请稍后重试</div>}
        {code && (
          <div className="bg-card border border-line rounded-xl p-4">
            <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1.5">团队邀请码</div>
            <div className="text-[26px] font-bold tabular tracking-[0.15em] text-ink text-center py-1">{code}</div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={copyCode}
                className="flex-1 rounded-lg bg-plan text-card py-2 text-[12.5px] font-medium flex items-center justify-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" strokeWidth={1.8} />
                {copied ? '已复制' : '复制邀请码'}
              </button>
              <button
                onClick={() => setConfirmingRegenerate(true)}
                className="rounded-lg border border-line px-3 py-2 text-muted flex items-center justify-center"
                title="重新生成邀请码（旧码会失效）"
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.8} />
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmingRegenerate && (
        <ConfirmDialog
          title="重新生成邀请码？"
          message="旧的邀请码会立刻失效，之前发出去的邀请码将无法再使用，需要把新码重新发给对方。"
          confirmLabel="重新生成"
          onConfirm={confirmRegenerate}
          onCancel={() => setConfirmingRegenerate(false)}
        />
      )}
    </div>
  )
}
