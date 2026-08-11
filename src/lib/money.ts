export function formatMoney(amount: number, currency = 'RM') {
  const rounded = Math.round(amount).toLocaleString('en-US')
  return `${currency}${rounded}`
}

export function formatAmountPlain(amount: number) {
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
