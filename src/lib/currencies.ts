export interface Currency {
  code: string // ISO 4217，大写
  nameZh: string
}

// 常见旅行会用到的币种，按中文名/代码搜索用。跟 lib/countries.ts 是同一个思路：
// 不追求 ISO 4217 全部 170+ 种都收进来，覆盖亚洲主要货币+欧美主要货币+
// 大洋洲/中东热门目的地够用；真遇到列表里没有的币种，行程货币设置和记一笔
// 都留了手动输入的路子，不会被这份列表卡死
export const CURRENCIES: Currency[] = [
  { code: 'MYR', nameZh: '马来西亚令吉' },
  { code: 'CNY', nameZh: '人民币' },
  { code: 'HKD', nameZh: '港币' },
  { code: 'MOP', nameZh: '澳门元' },
  { code: 'TWD', nameZh: '新台币' },
  { code: 'JPY', nameZh: '日元' },
  { code: 'KRW', nameZh: '韩元' },
  { code: 'SGD', nameZh: '新加坡元' },
  { code: 'THB', nameZh: '泰铢' },
  { code: 'VND', nameZh: '越南盾' },
  { code: 'KHR', nameZh: '柬埔寨瑞尔' },
  { code: 'LAK', nameZh: '老挝基普' },
  { code: 'MMK', nameZh: '缅甸元' },
  { code: 'PHP', nameZh: '菲律宾比索' },
  { code: 'IDR', nameZh: '印尼盾' },
  { code: 'BND', nameZh: '文莱元' },
  { code: 'INR', nameZh: '印度卢比' },
  { code: 'PKR', nameZh: '巴基斯坦卢比' },
  { code: 'LKR', nameZh: '斯里兰卡卢比' },
  { code: 'NPR', nameZh: '尼泊尔卢比' },
  { code: 'MVR', nameZh: '马尔代夫拉菲亚' },
  { code: 'AED', nameZh: '阿联酋迪拉姆' },
  { code: 'SAR', nameZh: '沙特里亚尔' },
  { code: 'QAR', nameZh: '卡塔尔里亚尔' },
  { code: 'TRY', nameZh: '土耳其里拉' },
  { code: 'ILS', nameZh: '以色列新谢克尔' },
  { code: 'GBP', nameZh: '英镑' },
  { code: 'EUR', nameZh: '欧元' },
  { code: 'CHF', nameZh: '瑞士法郎' },
  { code: 'DKK', nameZh: '丹麦克朗' },
  { code: 'NOK', nameZh: '挪威克朗' },
  { code: 'SEK', nameZh: '瑞典克朗' },
  { code: 'ISK', nameZh: '冰岛克朗' },
  { code: 'PLN', nameZh: '波兰兹罗提' },
  { code: 'CZK', nameZh: '捷克克朗' },
  { code: 'HUF', nameZh: '匈牙利福林' },
  { code: 'RON', nameZh: '罗马尼亚列伊' },
  { code: 'RUB', nameZh: '俄罗斯卢布' },
  { code: 'USD', nameZh: '美元' },
  { code: 'CAD', nameZh: '加拿大元' },
  { code: 'MXN', nameZh: '墨西哥比索' },
  { code: 'BRL', nameZh: '巴西雷亚尔' },
  { code: 'ARS', nameZh: '阿根廷比索' },
  { code: 'AUD', nameZh: '澳大利亚元' },
  { code: 'NZD', nameZh: '新西兰元' },
  { code: 'FJD', nameZh: '斐济元' },
  { code: 'EGP', nameZh: '埃及镑' },
  { code: 'MAD', nameZh: '摩洛哥迪拉姆' },
  { code: 'ZAR', nameZh: '南非兰特' },
  { code: 'MUR', nameZh: '毛里求斯卢比' },
]

export function searchCurrencies(query: string): Currency[] {
  const q = query.trim()
  if (!q) return []
  const upper = q.toUpperCase()
  return CURRENCIES.filter((c) => c.nameZh.includes(q) || c.code.includes(upper)).slice(0, 8)
}

export function currencyByCode(code: string) {
  return CURRENCIES.find((c) => c.code === code)
}
