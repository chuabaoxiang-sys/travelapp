import { useTranslation } from 'react-i18next'

// 「含估算」小标记（2026-11-08）：合计里有刷卡还没补实际扣款的估算时，贴在数字旁边；
// 全部补完就不渲染。深色卡上用半透明描边，浅色地方用跟账目上「待补」同一个橙色浅底
export function EstimatePill({ tone }: { tone: 'dark' | 'light' }) {
  const { t } = useTranslation()
  return tone === 'dark' ? (
    <span className="inline-block text-[10.5px] font-normal leading-normal tracking-normal px-[7px] py-px rounded-full border border-on-dark/30 text-on-dark/70 align-middle whitespace-nowrap">
      {t('estimate.pill')}
    </span>
  ) : (
    <span className="inline-block text-[10px] font-normal leading-normal px-1.5 rounded-full bg-spend/[.12] text-spend-text align-middle whitespace-nowrap">
      {t('estimate.pill')}
    </span>
  )
}
