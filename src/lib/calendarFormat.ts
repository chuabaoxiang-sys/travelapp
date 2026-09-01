// DatePicker.tsx（日期选择器弹层）和CalendarView.tsx（行程日历视图）各自有一套
// 月历网格，抬头都是"月份 年份"这个格式，逻辑完全一样，抽到这里共用一份，
// 不放进两个组件文件任一个里——那样会触发"文件只能导出组件"的Fast Refresh限制
export function monthYearLabel(y: number, m: number, locale: string, months: string[]) {
  return locale === 'zh' ? `${y}年 ${months[m - 1]}` : `${months[m - 1]} ${y}`
}
