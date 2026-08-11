// 给 Dexie 在 Node 测试环境里提供一个内存版 IndexedDB，这样带数据库查询的
// domain 函数（比如 computeBalances）也能在真正的测试里跑，不用整个跳过
import 'fake-indexeddb/auto'
