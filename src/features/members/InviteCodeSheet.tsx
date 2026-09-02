import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Copy, RefreshCw } from 'lucide-react'
import { getHouseholdInviteCode, regenerateHouseholdInviteCode } from '../../domain/household'
import { BottomSheet } from '../../components/BottomSheet'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useEscapeKey } from '../../hooks/useEscapeKey'

// 给团队里的现有成员看/复制/重新生成自己团队的邀请码——想邀请家人朋友加入，
// 把这串码发给对方即可，不用再找开发者手动跑SQL
export function InviteCodeSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
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
    const message = t('inviteCode.shareMessage', { origin: window.location.origin, code, buttonLabel: t('emailLogin.haveInviteCode') })
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
    <>
    <BottomSheet onClose={onClose} cardClassName="px-5 pt-3.5 pb-7 max-h-[88%] overflow-y-auto no-scrollbar">
        <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-3.5" />
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-semibold">{t('inviteCode.title')}</span>
          <button onClick={onClose} className="text-muted" title={t('inviteCode.close')}>
            <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
        </div>
        <div className="text-[11.5px] text-muted leading-relaxed mb-4">
          {t('inviteCode.description')}
        </div>

        {code === undefined && <div className="text-[12px] text-muted text-center py-4">{t('inviteCode.loading')}</div>}
        {code === null && <div className="text-[12px] text-negative text-center py-4">{t('inviteCode.loadError')}</div>}
        {code && (
          <div className="bg-card border border-line rounded-xl p-4">
            <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1.5">{t('inviteCode.codeLabel')}</div>
            <div className="text-[26px] font-bold tabular tracking-[0.15em] text-ink text-center py-1">{code}</div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={copyCode}
                className="flex-1 rounded-lg bg-plan text-card py-2 text-[12.5px] font-medium flex items-center justify-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" strokeWidth={1.8} />
                {copied ? t('inviteCode.copied') : t('inviteCode.copy')}
              </button>
              <button
                onClick={() => setConfirmingRegenerate(true)}
                className="rounded-lg border border-line px-3 py-2 text-muted flex items-center justify-center"
                title={t('inviteCode.regenerateTitle')}
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.8} />
              </button>
            </div>
          </div>
        )}
    </BottomSheet>

      {confirmingRegenerate && (
        <ConfirmDialog
          title={t('inviteCode.regenerateConfirmTitle')}
          message={t('inviteCode.regenerateConfirmMessage')}
          confirmLabel={t('inviteCode.regenerateConfirm')}
          onConfirm={confirmRegenerate}
          onCancel={() => setConfirmingRegenerate(false)}
        />
      )}
    </>
  )
}
