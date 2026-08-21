export function round2(n: number) {
  return Math.round(n * 100) / 100
}

// 先按分四舍五入，再判断是不是整数——这样即使传进来的amount本身带着浮点误差
// （比如汇率相乘算出来的509.60000000000002），显示时也只会看到干净的两位小数，
// 不会把这种计算噪音暴露给用户
export function formatMoney(amount: number, currency = 'RM') {
  const cents = Math.round(amount * 100)
  const isWhole = cents % 100 === 0
  const value = cents / 100
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${currency}${formatted}`
}

export function formatAmountPlain(amount: number) {
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
