export interface GeocodeResult {
  displayName: string
  lat: number
  lng: number
}

// Nominatim 使用政策要求：带上有辨识度的 User-Agent，且不要高频调用——
// 调用方（LocationPicker）已经做了输入防抖，这里只额外做一层内存缓存，
// 避免同一个关键词短时间内被重复请求
const cache = new Map<string, GeocodeResult[]>()

// countryCodes：这趟行程设置的目的地国家（ISO alpha-2），传给Nominatim的
// countrycodes 参数把搜索结果限制在这些国家内，避免搜到同名但隔了十万八千里的地方
// （比如搜"大阪城"混进新疆的"达坂城"）。不传就是全球搜索，跟以前一样。
export async function searchPlaces(query: string, countryCodes?: string[]): Promise<GeocodeResult[]> {
  const key = `${query.trim().toLowerCase()}|${(countryCodes ?? []).join(',')}`
  if (!key) return []
  if (cache.has(key)) return cache.get(key)!

  const params = new URLSearchParams({ format: 'json', q: query.trim(), limit: '6' })
  if (countryCodes?.length) params.set('countrycodes', countryCodes.join(','))

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'zh-CN,zh,en' },
  })
  if (!res.ok) return []
  const data = await res.json()
  const results: GeocodeResult[] = data.map((d: { display_name: string; lat: string; lon: string }) => ({
    displayName: d.display_name,
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
  }))
  cache.set(key, results)
  return results
}
