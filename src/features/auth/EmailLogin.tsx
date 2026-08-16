import { useEffect, useRef, useState } from 'react'
import { Mail, KeyRound } from 'lucide-react'
import { sendLoginCode, verifyLoginCode, joinHouseholdByInviteCode, NotInvitedError } from '../../domain/household'
import { enableLocalTestMode } from '../../dev/localTestMode'

const CODE_LENGTH = 6
const RESEND_SECONDS = 30

type CodeStatus = 'idle' | 'checking' | 'error' | 'success'

export function EmailLogin() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 邮箱没被邀请时，除了"联系邀请你的人"，还给一条自助路径：如果对方手上有
  // 邀请码，可以自己输入邮箱+邀请码直接加入团队，不用真的回头去找人工开通
  const [showInviteCode, setShowInviteCode] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [codeStatus, setCodeStatus] = useState<CodeStatus>('idle')
  const [resendSeconds, setResendSeconds] = useState(RESEND_SECONDS)
  const [resendBusy, setResendBusy] = useState(false)
  const [resendNotice, setResendNotice] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // 验证码这一步，每秒把倒计时减1；换回邮箱步骤时自动停止，不用在每次
  // resendSeconds变化时重启计时器（resend成功后把它重置回30，同一个
  // interval接着往下数就行）
  useEffect(() => {
    if (step !== 'code') return
    const timer = setInterval(() => setResendSeconds((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(timer)
  }, [step])

  function enterCodeStep() {
    setStep('code')
    setDigits(Array(CODE_LENGTH).fill(''))
    setCodeStatus('idle')
    setResendSeconds(RESEND_SECONDS)
    setTimeout(() => inputRefs.current[0]?.focus(), 0)
  }

  async function handleSend() {
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    try {
      await sendLoginCode(email)
      enterCodeStep()
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
      await sendLoginCode(email)
      enterCodeStep()
    } catch {
      setJoinError('加入失败，请稍后重试')
    } finally {
      setJoinBusy(false)
    }
  }

  async function submitCode(code: string) {
    setCodeStatus('checking')
    try {
      await verifyLoginCode(email, code)
      setCodeStatus('success')
    } catch {
      setCodeStatus('error')
      setDigits(Array(CODE_LENGTH).fill(''))
      setTimeout(() => inputRefs.current[0]?.focus(), 0)
    }
  }

  function setDigit(i: number, raw: string) {
    const value = raw.replace(/[^0-9]/g, '').slice(-1)
    const next = [...digits]
    next[i] = value
    setDigits(next)
    if (codeStatus === 'error') setCodeStatus('idle')
    if (value && i < CODE_LENGTH - 1) inputRefs.current[i + 1]?.focus()
    if (next.every((d) => d)) void submitCode(next.join(''))
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputRefs.current[i - 1]?.focus()
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, CODE_LENGTH)
    if (!text) return
    e.preventDefault()
    const next = Array(CODE_LENGTH).fill('')
    text.split('').forEach((ch, i) => { next[i] = ch })
    setDigits(next)
    setCodeStatus('idle')
    const nextEmpty = next.findIndex((d) => !d)
    inputRefs.current[nextEmpty === -1 ? CODE_LENGTH - 1 : nextEmpty]?.focus()
    if (next.every((d) => d)) void submitCode(next.join(''))
  }

  async function handleResend() {
    if (resendSeconds > 0 || resendBusy) return
    setResendBusy(true)
    try {
      await sendLoginCode(email)
      setResendSeconds(RESEND_SECONDS)
      setResendNotice(true)
      setTimeout(() => setResendNotice(false), 2000)
    } catch {
      // 重发失败不影响用户继续用手上已有的验证码尝试，静默失败，用户还能再点一次
    } finally {
      setResendBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-card rounded-3xl p-6 border border-line">
        <div className="text-[11px] tracking-widest text-muted uppercase">旅记 · TripJournal</div>

        {step === 'email' && (
          <>
            <h1 className="font-serif-sc text-2xl mt-2 text-ink">先登录一下</h1>
            <p className="text-sm text-muted mt-1">输入邮箱，我们发一个6位验证码过去，填进去就能进（不用记密码）</p>
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
                {busy ? '发送中…' : '发送验证码'}
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

        {step === 'code' && codeStatus === 'success' && (
          <div className="mt-6 text-center py-4">
            <div className="w-10 h-10 rounded-full bg-positive text-card flex items-center justify-center mx-auto mb-3 text-lg">✓</div>
            <div className="font-serif-sc text-lg text-ink">验证成功</div>
            <p className="text-[12.5px] text-muted mt-1">正在进入旅记…</p>
          </div>
        )}

        {step === 'code' && codeStatus !== 'success' && (
          <>
            <h1 className="font-serif-sc text-2xl mt-2 text-ink">查一下验证码</h1>
            <p className="text-sm text-muted mt-1">
              验证码已经发到 <span className="text-ink font-medium">{email}</span> 了，填进去就能登录（记得看看垃圾邮件夹）
            </p>

            <div className={`mt-5 flex gap-2 justify-between ${codeStatus === 'error' ? 'shake' : ''}`}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el }}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={i === 0 ? handlePaste : undefined}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  maxLength={1}
                  disabled={codeStatus === 'checking'}
                  className={`w-full aspect-square text-center text-lg font-semibold tabular rounded-xl border bg-paper outline-none ${
                    codeStatus === 'error' ? 'border-negative' : 'border-line focus:border-plan'
                  }`}
                />
              ))}
            </div>
            <div className="min-h-[16px] mt-2 text-[12px]">
              {codeStatus === 'error' && <span className="text-negative">验证码不对，再看看</span>}
              {codeStatus === 'checking' && <span className="text-muted">正在验证…</span>}
            </div>

            <div className="mt-3 pt-3 border-t border-line flex flex-col gap-1.5">
              <button
                onClick={handleResend}
                disabled={resendSeconds > 0 || resendBusy}
                className="text-[12.5px] text-plan text-left disabled:text-muted"
              >
                {resendSeconds > 0 ? `没收到？${resendSeconds}秒后可重新发送` : resendBusy ? '发送中…' : '重新发送验证码'}
              </button>
              {resendNotice && <div className="text-[11.5px] text-positive">已重新发送</div>}
            </div>
            <button onClick={() => setStep('email')} className="mt-3 text-[12px] text-muted text-left">
              换个邮箱
            </button>
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
