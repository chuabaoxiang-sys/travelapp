import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, RotateCw } from 'lucide-react'
import {
  getAdminDashboardStats,
  isNotAuthorizedError,
  isWithinDays,
  sliceDaily,
  funnelRows,
  funnelNote,
  neverCameBack,
  followUpCount,
  householdHasNoActivity,
  integerTicks,
  chartMaxValue,
  xLabelIndices,
  formatDateKeyMonthDay,
  formatMonthDay,
  formatMonthDayTime,
  stuckSyncHouseholdCount,
  syncReason,
  usesOldVersion,
  resolvedAfter,
  ledgerMismatchSummary,
  type AdminDashboardStats,
  type AdminLedgerMismatch,
  type AdminDailyRow,
  type AdminFunnel,
  type AdminHousehold,
  type AdminStuckAccount,
  type AdminSyncProblem,
  type AdminSyncProblemItem,
  type ChartRange,
} from '../../domain/adminStats'
import { relativeTime } from '../../lib/relativeTime'
import { APP_COMMIT } from '../../lib/appVersion'
import { formatMoney } from '../../lib/money'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; forbidden: boolean }
  | { status: 'ready'; stats: AdminDashboardStats }

// 只读页面：只展示数量和名字，不提供任何改数据的按钮，避免在这里误删人、误改账
export function AdminDashboardScreen({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    getAdminDashboardStats()
      .then((stats) => {
        if (!cancelled) setState({ status: 'ready', stats })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', forbidden: isNotAuthorizedError(err) })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  function retry() {
    setState({ status: 'loading' })
    setAttempt((a) => a + 1)
  }

  const subtitle =
    state.status === 'ready'
      ? `${t('admin.onlyYou')} · ${t('admin.updatedAt', { time: relativeTime(Date.parse(state.stats.generatedAt), Date.now(), t) })}`
      : t('admin.onlyYou')

  return (
    <div className="absolute inset-0 z-30 bg-paper flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2.5 flex-shrink-0 border-b border-line">
        <div className="min-w-0">
          <div className="font-serif-sc text-[15px] font-semibold">{t('admin.title')}</div>
          <div className="text-[10.5px] text-muted mt-0.5 truncate">{subtitle}</div>
        </div>
        <button onClick={onClose} className="text-muted flex-shrink-0" title={t('admin.close')}>
          <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-3.5 pb-safe-nav">
        {state.status === 'loading' && <div className="text-[12px] text-muted text-center py-16">{t('admin.loading')}</div>}

        {state.status === 'error' && (
          <div className="flex flex-col items-center text-center gap-3 py-16">
            <div className="text-[12.5px] text-soft">{state.forbidden ? t('admin.errorForbidden') : t('admin.errorGeneric')}</div>
            <button
              onClick={retry}
              className="flex items-center gap-1.5 rounded-[10px] border border-line bg-card px-3.5 py-2 text-[12px] font-medium text-plan"
            >
              <RotateCw className="w-[14px] h-[14px]" strokeWidth={1.8} />
              {t('admin.retry')}
            </button>
          </div>
        )}

        {state.status === 'ready' && <DashboardBody stats={state.stats} />}
      </div>
    </div>
  )
}

function DashboardBody({ stats }: { stats: AdminDashboardStats }) {
  const now = Date.now()
  return (
    <div className="flex flex-col gap-3.5">
      <HeroTotals stats={stats} />
      {/* 放在总数下面第一张：有人同步卡住是要马上处理的事，其他卡片都只是"看看趋势"。
          ?? [] 是给 0041 迁移还没跑到的数据库留的退路 */}
      <SyncProblemsCard problems={stats.syncProblems ?? []} />
      {/* 同上，?? [] 是给 0042 迁移还没跑到的数据库留的退路 */}
      <LedgerMismatchCard rows={stats.ledgerMismatches ?? []} />
      <FunnelCard funnel={stats.funnel} />
      <DailyChartCard daily={stats.daily} />
      <StuckAccountsCard accounts={stats.stuckAccounts} now={now} />
      <HouseholdsCard households={stats.households} now={now} />
    </div>
  )
}

function HeroTotals({ stats }: { stats: AdminDashboardStats }) {
  const { t } = useTranslation()
  const cells: { key: keyof AdminDashboardStats['totals']; label: string }[] = [
    { key: 'accounts', label: t('admin.hero.accounts') },
    { key: 'households', label: t('admin.hero.households') },
    { key: 'trips', label: t('admin.hero.trips') },
    { key: 'supportedHouseholds', label: t('admin.hero.supported') },
  ]
  return (
    <div className="bg-surface-strong text-on-dark rounded-[18px] px-[18px] py-4">
      <div className="text-[11px] opacity-65">{t('admin.hero.label')}</div>
      <div className="grid grid-cols-4 gap-1.5 mt-2.5 tabular">
        {cells.map((c) => (
          <div key={c.key} className="min-w-0">
            <div className="text-[24px] font-bold leading-[1.1]">{stats.totals[c.key]}</div>
            <div className="text-[10.5px] opacity-65 mt-[3px]">{c.label}</div>
            <div className="text-[10px] text-plan-on-dark mt-0.5">{t('admin.hero.last7Days', { n: stats.last7Days[c.key] })}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-card border border-line rounded-2xl px-4 py-3.5">
      <div className="text-[13px] font-semibold flex justify-between items-baseline gap-2">
        <span>{title}</span>
        {aside}
      </div>
      {children}
    </div>
  )
}

function CardAside({ children, className = 'text-muted' }: { children: ReactNode; className?: string }) {
  return <small className={`text-[10.5px] font-normal ${className}`}>{children}</small>
}

function funnelNoteText(funnel: AdminFunnel, t: TFunction): string {
  const note = funnelNote(funnel)
  if (note.kind === 'empty') return t('admin.funnel.empty')
  if (note.kind === 'noDrop') return t('admin.funnel.noDrop')
  const steps = note.drops
    .map((d) =>
      t('admin.funnel.dropPair', {
        from: t(`admin.funnel.steps.${d.from}`),
        to: t(`admin.funnel.steps.${d.to}`),
      }),
    )
    .join(t('admin.funnel.dropSeparator'))
  const key = note.drops.length > 1 ? 'admin.funnel.biggestDropTied' : 'admin.funnel.biggestDrop'
  return t(key, { steps, count: note.lost })
}

function FunnelCard({ funnel }: { funnel: AdminFunnel }) {
  const { t } = useTranslation()
  return (
    <Card title={t('admin.funnel.title')} aside={<CardAside>{t('admin.funnel.subtitle')}</CardAside>}>
      <div className="flex flex-col gap-[9px] mt-3 tabular">
        {funnelRows(funnel).map((row, i) => (
          <div key={row.step} className="grid grid-cols-[84px_1fr_48px] items-center gap-2 text-[11.5px]">
            <span className="text-soft truncate">{t(`admin.funnel.steps.${row.step}`)}</span>
            <div className="h-2.5 rounded-full bg-segment overflow-hidden">
              <div className="h-full rounded-full bg-plan" style={{ width: `${row.percent}%` }} />
            </div>
            <span className="text-right font-semibold whitespace-nowrap">
              {row.count}
              {i > 0 && <span className="text-muted font-normal text-[10px] ml-0.5">{row.percent}%</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="text-[10.5px] text-muted mt-2.5 leading-[1.55]">{funnelNoteText(funnel, t)}</div>
    </Card>
  )
}

const CHART_W = 330
const CHART_TOP = 14
const CHART_BASE = 94
const CHART_H = 118
// 测试账号叠在真实账号上面，压成很淡的一截——看得出"那天有人注册"，但一眼能分出来不计入总数
const TEST_OPACITY = 0.28

function DailyChartCard({ daily }: { daily: AdminDailyRow[] }) {
  const { t } = useTranslation()
  const [range, setRange] = useState<ChartRange>('30d')
  const rows = sliceDaily(daily, range)
  const hasTest = rows.some((r) => r.testAccounts > 0)

  const ranges: { value: ChartRange; label: string }[] = [
    { value: '7d', label: t('admin.chart.range7d') },
    { value: '30d', label: t('admin.chart.range30d') },
    { value: 'all', label: t('admin.chart.rangeAll') },
  ]

  return (
    <Card
      title={t('admin.chart.title')}
      aside={
        <span className="inline-flex bg-segment rounded-lg p-0.5 text-[10.5px] font-normal">
          {ranges.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-2 py-[3px] rounded-md ${range === r.value ? 'bg-card text-ink font-semibold' : 'text-muted'}`}
            >
              {r.label}
            </button>
          ))}
        </span>
      }
    >
      {rows.length === 0 ? (
        <div className="text-[11px] text-muted mt-3">{t('admin.chart.empty')}</div>
      ) : (
        <div className="mt-3">
          <DailyChart rows={rows} ariaLabel={t('admin.chart.ariaLabel')} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-soft mt-1.5">
            <LegendItem className="bg-plan" label={t('admin.chart.legendAccounts')} />
            <LegendItem className="bg-spend" label={t('admin.chart.legendTrips')} />
            {hasTest && <LegendItem className="bg-plan" faint label={t('admin.chart.legendTestAccounts')} />}
          </div>
        </div>
      )}
    </Card>
  )
}

function LegendItem({ className, label, faint }: { className: string; label: string; faint?: boolean }) {
  return (
    <span className="inline-flex items-center">
      <i className={`inline-block w-[7px] h-[7px] rounded-[2px] mr-1 ${className}`} style={faint ? { opacity: TEST_OPACITY } : undefined} />
      {label}
    </span>
  )
}

function DailyChart({ rows, ariaLabel }: { rows: AdminDailyRow[]; ariaLabel: string }) {
  const ticks = integerTicks(chartMaxValue(rows))
  const top = ticks[ticks.length - 1]
  // 纵轴数字位数多了就把柱子整体往右让一点，不然"10""150"会压在第一根柱子上
  const left = 7 + 5 * String(top).length
  const slot = (CHART_W - left) / rows.length
  // 天数多（"全部"可能有几十上百天）时柱子跟着变细，7天时也不至于粗成色块
  const barW = Math.min(7, slot * 0.34)
  const gap = Math.min(2, slot * 0.08)
  const pairW = barW * 2 + gap
  const rx = Math.min(1, barW / 2)
  const yOf = (v: number) => CHART_BASE - (v / top) * (CHART_BASE - CHART_TOP)
  const pairX = (i: number) => left + i * slot + (slot - pairW) / 2
  const labelIdx = xLabelIndices(rows.length)
  const lastIdx = rows.length - 1

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label={ariaLabel} className="block w-full h-auto">
      <line x1={0} x2={CHART_W} y1={CHART_BASE} y2={CHART_BASE} stroke="var(--color-line)" />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={0} x2={CHART_W} y1={yOf(v)} y2={yOf(v)} stroke="var(--color-line)" strokeDasharray="2 3" />
          <text x={0} y={yOf(v) - 3} fontSize={8} fill="var(--color-muted)" className="tabular">
            {v}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const x = pairX(i)
        return (
          <g key={r.date}>
            {r.accounts > 0 && (
              <rect x={x} y={yOf(r.accounts)} width={barW} height={CHART_BASE - yOf(r.accounts)} rx={rx} fill="var(--color-plan)" />
            )}
            {r.testAccounts > 0 && (
              <rect
                x={x}
                y={yOf(r.accounts + r.testAccounts)}
                width={barW}
                height={yOf(r.accounts) - yOf(r.accounts + r.testAccounts)}
                rx={rx}
                fill="var(--color-plan)"
                opacity={TEST_OPACITY}
              />
            )}
            {r.trips > 0 && (
              <rect
                x={x + barW + gap}
                y={yOf(r.trips)}
                width={barW}
                height={CHART_BASE - yOf(r.trips)}
                rx={rx}
                fill="var(--color-spend)"
              />
            )}
          </g>
        )
      })}
      {labelIdx.map((i) => {
        // 首尾标签贴着柱子左/右边缘对齐，中间的居中——不然最后一个日期会伸出画布
        const anchor = i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle'
        const x = i === 0 ? pairX(i) : i === lastIdx ? pairX(i) + pairW : pairX(i) + pairW / 2
        return (
          <text key={i} x={x} y={108} fontSize={8.5} fill="var(--color-muted)" textAnchor={anchor} className="tabular">
            {formatDateKeyMonthDay(rows[i].date)}
          </text>
        )
      })}
    </svg>
  )
}

function Pill({ tone, children }: { tone: 'new' | 'test' | 'exempt' | 'supported' | 'stuck' | 'resolved' | 'oldVersion'; children: ReactNode }) {
  const toneClass = {
    new: 'bg-positive/[0.12] text-positive',
    test: 'bg-segment text-muted',
    exempt: 'bg-plan/[0.1] text-plan',
    supported: 'bg-spend/[0.12] text-spend-text',
    stuck: 'bg-negative/[0.11] text-negative',
    resolved: 'bg-positive/[0.12] text-positive',
    oldVersion: 'bg-spend/[0.12] text-spend-text',
  }[tone]
  return (
    <span className={`inline-block text-[9.5px] font-semibold rounded-full px-[7px] py-px ml-[5px] align-[1px] ${toneClass}`}>
      {children}
    </span>
  )
}

function ListRow({ name, pills, meta, side }: { name: string; pills: ReactNode; meta: string; side?: ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-2.5 py-[9px] border-t border-line first:border-t-0">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium truncate">
          {name}
          {pills}
        </div>
        <div className="text-[10.5px] text-muted mt-0.5">{meta}</div>
      </div>
      {side}
    </div>
  )
}

// 一种卡住原因一小段："汇率簿 汇率重名 ×1"，表名加粗——跟设计稿一致
function SyncItem({ item }: { item: AdminSyncProblemItem }) {
  const { t } = useTranslation()
  const reason = syncReason(item)
  return (
    <span>
      <Trans
        i18nKey="admin.sync.item"
        values={{
          table: t(`syncDetail.tables.${item.table}`, { defaultValue: item.table }),
          reason: 'text' in reason ? reason.text : t(reason.key, reason.values),
          n: item.count,
        }}
        components={{ b: <b className="text-ink font-semibold" /> }}
      />
    </span>
  )
}

function syncProblemMeta(p: AdminSyncProblem, t: TFunction): string {
  const version = p.appVersions.join(' / ')
  if (p.stuck) {
    return t('admin.sync.metaStuck', { since: formatMonthDayTime(p.since), n: p.maxAttempts, version })
  }
  const after = resolvedAfter(p.since, p.resolvedAt ?? p.lastReportedAt)
  return t('admin.sync.metaResolved', {
    since: formatMonthDayTime(p.since),
    after: t(`admin.sync.after.${after.unit}`, { count: after.count }),
    version,
  })
}

function SyncProblemsCard({ problems }: { problems: AdminSyncProblem[] }) {
  const { t } = useTranslation()
  const stuckHouseholds = stuckSyncHouseholdCount(problems)
  const anyStuck = problems.some((p) => p.stuck)
  return (
    <Card
      title={t('admin.sync.title')}
      aside={
        stuckHouseholds > 0 ? (
          <CardAside className="text-negative font-semibold">{t('admin.sync.stuckHouseholds', { count: stuckHouseholds })}</CardAside>
        ) : (
          <CardAside>{anyStuck ? t('admin.sync.onlyTest') : t('admin.sync.allGood')}</CardAside>
        )
      }
    >
      {problems.length === 0 ? (
        <div className="text-[11px] text-muted mt-2">{t('admin.sync.empty')}</div>
      ) : (
        <div className="mt-2 flex flex-col">
          {problems.map((p) => (
            <div
              key={`${p.householdName}-${p.email}`}
              className={`py-[9px] border-t border-line first:border-t-0 flex flex-col gap-[3px] ${p.stuck ? '' : 'opacity-75'}`}
            >
              <div className="text-[12.5px] font-medium break-words">
                {[p.householdName ?? t('admin.sync.noHousehold'), p.email].filter(Boolean).join(' · ')}
                {p.stuck ? <Pill tone="stuck">{t('admin.sync.pillStuck')}</Pill> : <Pill tone="resolved">{t('admin.sync.pillResolved')}</Pill>}
                {usesOldVersion(p, APP_COMMIT) && <Pill tone="oldVersion">{t('admin.sync.pillOldVersion')}</Pill>}
                {p.isTest && <Pill tone="test">{t('admin.pill.test')}</Pill>}
              </div>
              <div className="text-[11px] text-soft flex flex-wrap gap-x-2.5 gap-y-0.5">
                {p.items.map((item) => (
                  <SyncItem key={`${item.table}-${item.code}-${item.label}`} item={item} />
                ))}
              </div>
              <div className="text-[10.5px] text-muted tabular">{syncProblemMeta(p, t)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function LedgerMismatchCard({ rows }: { rows: AdminLedgerMismatch[] }) {
  const { t } = useTranslation()
  const summary = ledgerMismatchSummary(rows)
  return (
    <Card
      title={t('admin.ledger.title')}
      aside={
        summary.households > 0 ? (
          <CardAside className="text-negative font-semibold">
            {t('admin.ledger.summary', {
              count: summary.expenses,
              households: t('admin.ledger.households', { count: summary.households }),
            })}
          </CardAside>
        ) : (
          <CardAside>{rows.length > 0 ? t('admin.ledger.onlyTest') : t('admin.ledger.allGood')}</CardAside>
        )
      }
    >
      {rows.length === 0 ? (
        <div className="text-[11px] text-muted mt-2">{t('admin.ledger.empty')}</div>
      ) : (
        <>
          <div className="mt-2 flex flex-col">
            {rows.map((r) => (
              <ListRow
                key={`${r.householdName}-${r.currency}`}
                name={r.householdName ?? t('admin.ledger.unknownHousehold')}
                pills={r.isTest && <Pill tone="test">{t('admin.pill.test')}</Pill>}
                meta={t('admin.ledger.meta', { count: r.count, time: formatMonthDayTime(r.lastChangedAt) })}
                side={
                  <span className="text-[12.5px] font-semibold text-negative tabular whitespace-nowrap">
                    {t('admin.ledger.diff', { amount: formatMoney(r.diffTotal, r.currency === 'MYR' ? 'RM' : `${r.currency} `) })}
                  </span>
                }
              />
            ))}
          </div>
          <div className="text-[10.5px] text-muted leading-relaxed mt-1.5 pt-2 border-t border-dashed border-line">
            {t('admin.ledger.hint')}
          </div>
        </>
      )}
    </Card>
  )
}

function StuckAccountsCard({ accounts, now }: { accounts: AdminStuckAccount[]; now: number }) {
  const { t } = useTranslation()
  const followUp = followUpCount(accounts)
  return (
    <Card
      title={t('admin.stuck.title')}
      aside={
        followUp > 0 ? (
          <CardAside className="text-spend">{t('admin.stuck.followUp', { count: followUp })}</CardAside>
        ) : (
          <CardAside>{accounts.length > 0 ? t('admin.stuck.onlyTest') : t('admin.stuck.none')}</CardAside>
        )
      }
    >
      {accounts.length === 0 ? (
        <div className="text-[11px] text-muted mt-2">{t('admin.stuck.empty')}</div>
      ) : (
        <div className="mt-2 flex flex-col">
          {accounts.map((a) => {
            const provider = a.provider === 'google' ? t('admin.stuck.providerGoogle') : t('admin.stuck.providerEmail')
            const tail = neverCameBack(a)
              ? t('admin.stuck.neverCameBack')
              : t('admin.stuck.lastSeen', { date: formatMonthDay(a.lastSeenAt as string) })
            return (
              <ListRow
                key={`${a.email}-${a.createdAt}`}
                name={a.email}
                pills={
                  <>
                    {!a.isTest && isWithinDays(a.createdAt, now, 7) && <Pill tone="new">{t('admin.pill.new')}</Pill>}
                    {a.isTest && <Pill tone="test">{t('admin.pill.test')}</Pill>}
                  </>
                }
                meta={t('admin.stuck.signedUp', { provider, time: formatMonthDayTime(a.createdAt) }) + tail}
              />
            )
          })}
        </div>
      )}
    </Card>
  )
}

function householdMeta(h: AdminHousehold, t: TFunction): string {
  const created = formatMonthDay(h.createdAt)
  const base = householdHasNoActivity(h)
    ? t('admin.households.createdNoActivity', { created })
    : t('admin.households.createdWithActivity', { active: formatMonthDay(h.lastActivityAt ?? h.createdAt), created })
  return h.signedInMemberCount === 0 ? base + t('admin.households.noMemberSignedIn') : base
}

const STAT_BOLD = { b: <b className="text-ink font-semibold" /> }

function HouseholdsCard({ households, now }: { households: AdminHousehold[]; now: number }) {
  const { t } = useTranslation()
  return (
    <Card title={t('admin.households.title')} aside={<CardAside>{t('admin.households.subtitle')}</CardAside>}>
      {households.length === 0 ? (
        <div className="text-[11px] text-muted mt-2">{t('admin.households.empty')}</div>
      ) : (
        <div className="mt-2 flex flex-col">
          {households.map((h) => (
            <ListRow
              key={h.id}
              name={h.name}
              pills={
                <>
                  {!h.isTest && isWithinDays(h.createdAt, now, 7) && <Pill tone="new">{t('admin.pill.new')}</Pill>}
                  {h.isTest && <Pill tone="test">{t('admin.pill.test')}</Pill>}
                  {h.tripLimitExempt && !h.isTest && <Pill tone="exempt">{t('admin.pill.exempt')}</Pill>}
                  {h.supported && <Pill tone="supported">{t('admin.pill.supported')}</Pill>}
                </>
              }
              meta={householdMeta(h, t)}
              side={
                <div className="flex gap-2.5 justify-end text-soft text-[11px] tabular flex-shrink-0 whitespace-nowrap">
                  <span>
                    <Trans i18nKey="admin.households.members" count={h.memberCount} components={STAT_BOLD} />
                  </span>
                  <span>
                    <Trans i18nKey="admin.households.trips" count={h.tripCount} components={STAT_BOLD} />
                  </span>
                  <span>
                    <Trans i18nKey="admin.households.expenses" count={h.expenseCount} components={STAT_BOLD} />
                  </span>
                </div>
              }
            />
          ))}
        </div>
      )}
    </Card>
  )
}
