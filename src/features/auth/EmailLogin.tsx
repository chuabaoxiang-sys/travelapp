import { useEffect, useRef, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Mail, KeyRound } from 'lucide-react'
import { sendLoginCode, verifyLoginCode, joinHouseholdByInviteCode, NotInvitedError } from '../../domain/household'
import { enableLocalTestMode } from '../../dev/localTestMode'

const CODE_LENGTH = 6
const RESEND_SECONDS = 30

type CodeStatus = 'idle' | 'checking' | 'error' | 'success'

export function EmailLogin() {
  const { t } = useTranslation()
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
      setError(err instanceof NotInvitedError ? t('emailLogin.notInvited') : t('emailLogin.sendFailed'))
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
        setJoinError(t('emailLogin.invalidCode'))
        return
      }
      await sendLoginCode(email)
      enterCodeStep()
    } catch {
      setJoinError(t('emailLogin.joinFailed'))
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
        <div className="text-[11px] tracking-widest text-muted uppercase">{t('common.brand')}</div>

        {step === 'email' && (
          <>
            <h1 className="font-serif-sc text-2xl mt-2 text-ink">{t('emailLogin.title')}</h1>
            <p className="text-sm text-muted mt-1">{t('emailLogin.subtitle')}</p>
            <div className="mt-5 flex flex-col gap-2.5">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={t('emailLogin.emailPlaceholder')}
                autoFocus
                className="rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none focus:border-plan"
              />
              <button
                onClick={handleSend}
                disabled={busy || !email.trim()}
                className="rounded-xl bg-plan text-card py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <Mail className="w-4 h-4" strokeWidth={1.8} />
                {busy ? t('emailLogin.sending') : t('emailLogin.sendCode')}
              </button>
              {error && <div className="text-[12px] text-negative">{error}</div>}

              {showInviteCode ? (
                <div className="mt-1.5 pt-3 border-t border-line flex flex-col gap-2.5">
                  <p className="text-[12.5px] text-muted">{t('emailLogin.haveInviteCodePrompt')}</p>
                  <input
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleJoinByCode()}
                    placeholder={t('emailLogin.inviteCodePlaceholder')}
                    className="rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none focus:border-plan tracking-[0.1em]"
                  />
                  <button
                    onClick={handleJoinByCode}
                    disabled={joinBusy || !email.trim() || !inviteCode.trim()}
                    className="rounded-xl border border-plan text-plan py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
                  >
                    <KeyRound className="w-4 h-4" strokeWidth={1.8} />
                    {joinBusy ? t('emailLogin.joining') : t('emailLogin.joinByCode')}
                  </button>
                  {joinError && <div className="text-[12px] text-negative">{joinError}</div>}
                </div>
              ) : (
                <button onClick={() => setShowInviteCode(true)} className="text-[12.5px] text-plan text-left mt-0.5">
                  {t('emailLogin.haveInviteCode')}
                </button>
              )}
            </div>
          </>
        )}

        {step === 'code' && codeStatus === 'success' && (
          <div className="mt-6 text-center py-4">
            <div className="w-10 h-10 rounded-full bg-positive text-card flex items-center justify-center mx-auto mb-3 text-lg">✓</div>
            <div className="font-serif-sc text-lg text-ink">{t('emailLogin.verifySuccess')}</div>
            <p className="text-[12.5px] text-muted mt-1">{t('emailLogin.enteringApp')}</p>
          </div>
        )}

        {step === 'code' && codeStatus !== 'success' && (
          <>
            <h1 className="font-serif-sc text-2xl mt-2 text-ink">{t('emailLogin.enterCodeTitle')}</h1>
            <p className="text-sm text-muted mt-1">
              <Trans i18nKey="emailLogin.codeSentTo" values={{ email }} components={{ b: <span className="text-ink font-medium" /> }} />
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
              {codeStatus === 'error' && <span className="text-negative">{t('emailLogin.wrongCode')}</span>}
              {codeStatus === 'checking' && <span className="text-muted">{t('emailLogin.verifying')}</span>}
            </div>

            <div className="mt-3 pt-3 border-t border-line flex flex-col gap-1.5">
              <button
                onClick={handleResend}
                disabled={resendSeconds > 0 || resendBusy}
                className="text-[12.5px] text-plan text-left disabled:text-muted"
              >
                {resendSeconds > 0 ? t('emailLogin.resendWait', { seconds: resendSeconds }) : resendBusy ? t('emailLogin.sending') : t('emailLogin.resendCode')}
              </button>
              {resendNotice && <div className="text-[11.5px] text-positive">{t('emailLogin.resentNotice')}</div>}
            </div>
            <button onClick={() => setStep('email')} className="mt-3 text-[12px] text-muted text-left">
              {t('emailLogin.changeEmail')}
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
            {t('emailLogin.localTestMode')}
          </button>
        )}
      </div>
    </div>
  )
}
