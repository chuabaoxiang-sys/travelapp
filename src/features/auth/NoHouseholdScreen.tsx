import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, RefreshCw, KeyRound } from 'lucide-react'
import { createHousehold, joinHouseholdByInviteCode, getCurrentUserEmail, getCurrentHouseholdId, signOut } from '../../domain/household'

// 三个操作平级并列，一次只展开一个——跟EmailLogin.tsx"有邀请码？点这里输入"
// 是同一份表单逻辑，只是这里多了"邀请码"这一条（原来没有，Google登录跳过了
// EmailLogin页面那次填邀请码的机会，必须在这里补上，否则被邀请的人用Google
// 登录后无路可走，只能手滑点成"建新团队"）
type Panel = 'none' | 'code' | 'create'

export function NoHouseholdScreen({
  onHouseholdCreated,
  onSignOut,
}: {
  onHouseholdCreated: (id: string) => void
  onSignOut: () => void
}) {
  const { t } = useTranslation()
  const [panel, setPanel] = useState<Panel>('none')

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [inviteCode, setInviteCode] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  function togglePanel(p: Panel) {
    setPanel((current) => (current === p ? 'none' : p))
    setError(null)
    setJoinError(null)
  }

  async function handleCreate() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const id = await createHousehold(name)
      onHouseholdCreated(id)
    } catch {
      // create_household这个RPC自己会抛出面向用户的报错文案（开关未开/名字为空/
      // 未登录），但跨语言/跨环境的具体报错格式不保证稳定，这里统一显示一句通用
      // 提示，不直接把err.message糊给用户
      setError(t('noHousehold.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleJoinByCode() {
    if (!inviteCode.trim()) return
    setJoinBusy(true)
    setJoinError(null)
    try {
      const email = await getCurrentUserEmail()
      if (!email) {
        setJoinError(t('noHousehold.joinFailed'))
        return
      }
      const joined = await joinHouseholdByInviteCode(email, inviteCode)
      if (!joined) {
        setJoinError(t('noHousehold.invalidCode'))
        return
      }
      // 加入成功后household_member多了一行，但这个页面手上的householdId还是null——
      // 重新查一次getCurrentHouseholdId()，跟自助建团队成功后的处理方式一致，
      // 不用整页刷新。之前查询没查到值时cachedHouseholdId没被写入，这里能查到最新结果
      const id = await getCurrentHouseholdId()
      if (id) onHouseholdCreated(id)
      else setJoinError(t('noHousehold.joinFailed'))
    } catch {
      setJoinError(t('noHousehold.joinFailed'))
    } finally {
      setJoinBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-card rounded-3xl p-6 border border-line">
        <div className="text-[11px] tracking-widest text-muted uppercase">{t('common.brand')}</div>
        <h1 className="font-serif-sc text-xl mt-2 text-ink">{t('noHousehold.title')}</h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          {t('noHousehold.subtitle')}
        </p>

        <div className="mt-4 pt-3 border-t border-line flex flex-wrap gap-2">
          <button
            onClick={() => signOut().then(onSignOut)}
            className="flex items-center gap-1.5 rounded-full border border-line bg-paper text-ink px-3.5 py-1.5 text-[12px] font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.8} />
            {t('noHousehold.switchEmail')}
          </button>
          <button
            onClick={() => togglePanel('code')}
            className="flex items-center gap-1.5 rounded-full border border-plan text-plan px-3.5 py-1.5 text-[12px] font-medium"
          >
            <KeyRound className="w-3.5 h-3.5" strokeWidth={1.8} />
            {t('noHousehold.haveInviteCode')}
          </button>
          <button
            onClick={() => togglePanel('create')}
            className="flex items-center gap-1.5 rounded-full border border-plan text-plan px-3.5 py-1.5 text-[12px] font-medium"
          >
            <Users className="w-3.5 h-3.5" strokeWidth={1.8} />
            {t('noHousehold.createGroup')}
          </button>
        </div>

        {panel === 'code' && (
          <div className="mt-3 flex flex-col gap-2.5">
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoinByCode()}
              placeholder={t('noHousehold.inviteCodePlaceholder')}
              autoFocus
              className="rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none focus:border-plan tracking-[0.1em]"
            />
            <button
              onClick={handleJoinByCode}
              disabled={joinBusy || !inviteCode.trim()}
              className="rounded-xl bg-plan text-card py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              <KeyRound className="w-4 h-4" strokeWidth={1.8} />
              {joinBusy ? t('noHousehold.joining') : t('noHousehold.joinByCode')}
            </button>
            {joinError && <div className="text-[12px] text-negative">{joinError}</div>}
          </div>
        )}

        {panel === 'create' && (
          <div className="mt-3 flex flex-col gap-2.5">
            <p className="text-[12px] text-muted">{t('noHousehold.namePrompt')}</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder={t('noHousehold.namePlaceholder')}
              autoFocus
              className="rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none focus:border-plan"
            />
            <button
              onClick={handleCreate}
              disabled={busy || !name.trim()}
              className="rounded-xl bg-plan text-card py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              <Users className="w-4 h-4" strokeWidth={1.8} />
              {busy ? t('noHousehold.creating') : t('noHousehold.createGroup')}
            </button>
            {error && <div className="text-[12px] text-negative">{error}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
