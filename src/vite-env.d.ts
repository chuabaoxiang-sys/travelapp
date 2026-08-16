/// <reference types="vite/client" />

// vite.config.ts 的 define 在构建时注入的全局常量，见 src/lib/appVersion.ts
declare const __APP_COMMIT__: string
declare const __APP_BUILD_TIME__: string
