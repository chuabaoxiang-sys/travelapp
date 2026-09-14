// 给 Dexie 在 Node 测试环境里提供一个内存版 IndexedDB，这样带数据库查询的
// domain 函数（比如 computeBalances）也能在真正的测试里跑，不用整个跳过
import 'fake-indexeddb/auto'

// Node测试环境没有真的浏览器localStorage——theme.ts/locale.ts这类"记设备级偏好"
// 的代码一碰localStorage就会抛ReferenceError（不是返回undefined）。补一个内存版，
// 这样这些代码在测试里能走真实的读写路径，而不是每次都靠try/catch吞掉
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}
