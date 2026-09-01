import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Phase 0：只搭基础设施，还没把任何文案抽成翻译key——两个语言桶先留空对象，
// i18next能正常识别zh/en、changeLanguage不会报错，但界面显示暂时不受影响。
// 真正的文案会在后续phase里逐个功能区搬进来
i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: {} },
    en: { translation: {} },
  },
  lng: 'zh',
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
})

export default i18n
