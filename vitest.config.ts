import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 测试环境不跑真的git命令/构建流程，这两个常量随便给个固定值即可——
  // 用到它们的代码（domain/feedback.ts）只关心"有没有值"，不关心具体是什么
  define: {
    __APP_COMMIT__: JSON.stringify('test'),
    __APP_BUILD_TIME__: JSON.stringify(new Date(0).toISOString()),
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/testSetup.ts'],
  },
})
