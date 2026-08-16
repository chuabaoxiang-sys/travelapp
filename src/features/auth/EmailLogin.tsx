import { useState } from 'react'
import { Mail, KeyRound } from 'lucide-react'
import { sendLoginLink, joinHouseholdByInviteCode, NotInvitedError } from '../../domain/household'
import { enableLocalTestMode } from '../../dev/localTestMode'

export function EmailLogin() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 邮箱没被邀请时，除了"联系邀请你的人"，还给一条自助路径：如果对方手上有
  // 邀请码，可以自己输入邮箱+邀请码直接加入团队，不用真的回头去找人工开通
  const [showInviteCode, setShowInviteCode] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  async function handleSend() {
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    try {
      await sendLoginLink(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof NotInvitedError ? '这个邮箱还没被邀请，联系邀请你的人确认一下' : '发送失败，请检查邮箱地址后重试')
    } finally {
      setBusy(false)
    }
  }

  async function handleJoinByCode() {
    if (!email.trim() || !inviteCode.trim()) return
    setJoinBusy(true)
    setJoinError(null)
    try {
      const joined = await joinHouseholdByInviteCode(email, inviteCode)
      if (!joined) {
        setJoinError('邀请码无效，请确认后重试')
        return
      }
      await sendLoginLink(email)
      setSent(true)
    } catch {
      setJoinError('加入失败，请稍后重试')
    } finally {
      setJoinBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-card rounded-3xl p-6 border border-line">
        <div className="text-[11px] tracking-widest text-muted uppercase">旅记 · TripJournal</div>
        <h1 className="font-serif-sc text-2xl mt-2 text-ink">先登录一下</h1>

        {sent ? (
          <div className="mt-5 text-sm text-ink leading-relaxed">
            登录链接已经发到 <span className="font-medium">{email}</span> 了，去邮箱找一下（也看看垃圾邮件夹），点开里面的链接就能登录。
          </div>
        ) : (
          <>
            <p className="text-sm text-muted mt-1">输入邮箱，我们发一个登录链接过去，点开链接就能进（不用记密码）</p>
            <div className="mt-5 flex flex-col gap-2.5">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="你的邮箱"
                autoFocus
                className="rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none focus:border-plan"
              />
              <button
                onClick={handleSend}
                disabled={busy || !email.trim()}
                className="rounded-xl bg-plan text-card py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <Mail className="w-4 h-4" strokeWidth={1.8} />
                {busy ? '发送中…' : '发送登录链接'}
              </button>
              {error && <div className="text-[12px] text-negative">{error}</div>}

              {showInviteCode ? (
                <div className="mt-1.5 pt-3 border-t border-line flex flex-col gap-2.5">
                  <p className="text-[12.5px] text-muted">有团队的邀请码？输入邮箱（上面那栏）和邀请码，直接加入。</p>
                  <input
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleJoinByCode()}
                    placeholder="邀请码"
                    className="rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none focus:border-plan tracking-[0.1em]"
                  />
                  <button
                    onClick={handleJoinByCode}
                    disabled={joinBusy || !email.trim() || !inviteCode.trim()}
                    className="rounded-xl border border-plan text-plan py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
                  >
                    <KeyRound className="w-4 h-4" strokeWidth={1.8} />
                    {joinBusy ? '加入中…' : '用邀请码加入'}
                  </button>
                  {joinError && <div className="text-[12px] text-negative">{joinError}</div>}
                </div>
              ) : (
                <button onClick={() => setShowInviteCode(true)} className="text-[12.5px] text-plan text-left mt-0.5">
                  有邀请码？点这里输入
                </button>
              )}
            </div>
          </>
        )}

        {import.meta.env.DEV && (
          <button
            onClick={() => {
              enableLocalTestMode()
              window.location.reload()
            }}
            className="mt-4 pt-3 border-t border-line text-[12px] text-muted text-left w-full"
          >
            本地测试模式（跳过登录，看假数据 · 仅dev环境可见）
          </button>
        )}
      </div>
    </div>
  )
}
