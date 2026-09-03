export interface Currency {
  code: string // ISO 4217，大写
  nameZh: string
  nameEn: string
}

// 常见旅行会用到的币种，按中文名/代码搜索用。跟 lib/countries.ts 是同一个思路：
// 不追求 ISO 4217 全部 170+ 种都收进来，覆盖亚洲主要货币+欧美主要货币+
// 大洋洲/中东热门目的地够用；真遇到列表里没有的币种，行程货币设置和记一笔
// 都留了手动输入的路子，不会被这份列表卡死
export const CURRENCIES: Currency[] = [
  { code: 'MYR', nameZh: '马来西亚令吉', nameEn: 'Malaysian Ringgit' },
  { code: 'CNY', nameZh: '人民币', nameEn: 'Chinese Yuan' },
  { code: 'HKD', nameZh: '港币', nameEn: 'Hong Kong Dollar' },
  { code: 'MOP', nameZh: '澳门元', nameEn: 'Macanese Pataca' },
  { code: 'TWD', nameZh: '新台币', nameEn: 'New Taiwan Dollar' },
  { code: 'JPY', nameZh: '日元', nameEn: 'Japanese Yen' },
  { code: 'KRW', nameZh: '韩元', nameEn: 'South Korean Won' },
  { code: 'SGD', nameZh: '新加坡元', nameEn: 'Singapore Dollar' },
  { code: 'THB', nameZh: '泰铢', nameEn: 'Thai Baht' },
  { code: 'VND', nameZh: '越南盾', nameEn: 'Vietnamese Dong' },
  { code: 'KHR', nameZh: '柬埔寨瑞尔', nameEn: 'Cambodian Riel' },
  { code: 'LAK', nameZh: '老挝基普', nameEn: 'Lao Kip' },
  { code: 'MMK', nameZh: '缅甸元', nameEn: 'Myanmar Kyat' },
  { code: 'PHP', nameZh: '菲律宾比索', nameEn: 'Philippine Peso' },
  { code: 'IDR', nameZh: '印尼盾', nameEn: 'Indonesian Rupiah' },
  { code: 'BND', nameZh: '文莱元', nameEn: 'Brunei Dollar' },
  { code: 'INR', nameZh: '印度卢比', nameEn: 'Indian Rupee' },
  { code: 'PKR', nameZh: '巴基斯坦卢比', nameEn: 'Pakistani Rupee' },
  { code: 'LKR', nameZh: '斯里兰卡卢比', nameEn: 'Sri Lankan Rupee' },
  { code: 'NPR', nameZh: '尼泊尔卢比', nameEn: 'Nepalese Rupee' },
  { code: 'MVR', nameZh: '马尔代夫拉菲亚', nameEn: 'Maldivian Rufiyaa' },
  { code: 'AED', nameZh: '阿联酋迪拉姆', nameEn: 'UAE Dirham' },
  { code: 'SAR', nameZh: '沙特里亚尔', nameEn: 'Saudi Riyal' },
  { code: 'QAR', nameZh: '卡塔尔里亚尔', nameEn: 'Qatari Riyal' },
  { code: 'TRY', nameZh: '土耳其里拉', nameEn: 'Turkish Lira' },
  { code: 'ILS', nameZh: '以色列新谢克尔', nameEn: 'Israeli New Shekel' },
  { code: 'GBP', nameZh: '英镑', nameEn: 'British Pound' },
  { code: 'EUR', nameZh: '欧元', nameEn: 'Euro' },
  { code: 'CHF', nameZh: '瑞士法郎', nameEn: 'Swiss Franc' },
  { code: 'DKK', nameZh: '丹麦克朗', nameEn: 'Danish Krone' },
  { code: 'NOK', nameZh: '挪威克朗', nameEn: 'Norwegian Krone' },
  { code: 'SEK', nameZh: '瑞典克朗', nameEn: 'Swedish Krona' },
  { code: 'ISK', nameZh: '冰岛克朗', nameEn: 'Icelandic Króna' },
  { code: 'PLN', nameZh: '波兰兹罗提', nameEn: 'Polish Złoty' },
  { code: 'CZK', nameZh: '捷克克朗', nameEn: 'Czech Koruna' },
  { code: 'HUF', nameZh: '匈牙利福林', nameEn: 'Hungarian Forint' },
  { code: 'RON', nameZh: '罗马尼亚列伊', nameEn: 'Romanian Leu' },
  { code: 'RUB', nameZh: '俄罗斯卢布', nameEn: 'Russian Ruble' },
  { code: 'USD', nameZh: '美元', nameEn: 'US Dollar' },
  { code: 'CAD', nameZh: '加拿大元', nameEn: 'Canadian Dollar' },
  { code: 'MXN', nameZh: '墨西哥比索', nameEn: 'Mexican Peso' },
  { code: 'BRL', nameZh: '巴西雷亚尔', nameEn: 'Brazilian Real' },
  { code: 'ARS', nameZh: '阿根廷比索', nameEn: 'Argentine Peso' },
  { code: 'AUD', nameZh: '澳大利亚元', nameEn: 'Australian Dollar' },
  { code: 'NZD', nameZh: '新西兰元', nameEn: 'New Zealand Dollar' },
  { code: 'FJD', nameZh: '斐济元', nameEn: 'Fijian Dollar' },
  { code: 'EGP', nameZh: '埃及镑', nameEn: 'Egyptian Pound' },
  { code: 'MAD', nameZh: '摩洛哥迪拉姆', nameEn: 'Moroccan Dirham' },
  { code: 'ZAR', nameZh: '南非兰特', nameEn: 'South African Rand' },
  { code: 'MUR', nameZh: '毛里求斯卢比', nameEn: 'Mauritian Rupee' },
]

export function searchCurrencies(query: string): Currency[] {
  const q = query.trim()
  if (!q) return []
  const upper = q.toUpperCase()
  const lower = q.toLowerCase()
  return CURRENCIES.filter((c) => c.nameZh.includes(q) || c.nameEn.toLowerCase().includes(lower) || c.code.includes(upper)).slice(0, 8)
}

export function currencyByCode(code: string) {
  return CURRENCIES.find((c) => c.code === code)
}
