// 汇率参考值来源：Frankfurter（免密钥，欧洲央行数据源）。这里只用来给汇率簿的
// "新增汇率"表单预填一个参考数字，用户随时可以改；请求失败/离线时安静返回 null，
// 不阻塞、不报错——手动输入汇率永远是主路径，API只是锦上添花。
export async function fetchReferenceRate(fromCurrency: string, toCurrency: string): Promise<number | null> {
  try {
    const url = `https://api.frankfurter.dev/v1/latest?base=${fromCurrency}&symbols=${toCurrency}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const rate = data?.rates?.[toCurrency]
    return typeof rate === 'number' ? rate : null
  } catch {
    return null
  }
}
