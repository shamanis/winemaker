/**
 * Фабрика экземпляров i18next (design D3): main и renderer создают
 * независимые экземпляры из одних ресурсов и настроек. Ресурсы зашиты
 * в сборку (D11): никаких загрузок в рантайме, работа без сети.
 * Renderer передаёт initReactI18next через plugins; shared не знает про react.
 */
import { createInstance, type i18n as I18nInstance, type TFunction } from 'i18next'
import { resources } from './locales'
import { LANGUAGE_CODES, type Language } from './resolve-language'

/** Именованные форматы чисел (design D10): разделитель — точка в обеих локалях. */
const NUMBER_FORMATS: Record<string, (value: number) => string> = {
  fixed1: (value) => value.toFixed(1),
  fixed2: (value) => value.toFixed(2),
  fixed4: (value) => value.toFixed(4)
}

type I18nPlugin = Parameters<I18nInstance['use']>[0]

export function createI18n(
  language: Language,
  plugins: readonly I18nPlugin[] = []
): I18nInstance {
  const instance = createInstance()
  for (const plugin of plugins) {
    instance.use(plugin)
  }
  // initAsync: false — с зашитыми ресурсами экземпляр готов сразу
  // после init (синхронно), t() можно вызывать без ожидания промиса.
  void instance.init({
    lng: language,
    fallbackLng: 'en',
    supportedLngs: [...LANGUAGE_CODES],
    resources,
    initAsync: false,
    // React сам экранирует текст; меню Electron в экранировании не нуждается.
    interpolation: { escapeValue: false }
  })
  // В v27 встроенный Formatter перезаписывает interpolation.format при init —
  // именованные форматы регистрируются официально, через services.formatter.
  const formatter = (instance.services as { formatter?: { add(name: string, fn: (v: unknown) => string): void } })
    .formatter
  if (formatter) {
    for (const [name, fn] of Object.entries(NUMBER_FORMATS)) {
      formatter.add(name, (value) =>
        typeof value === 'number' && Number.isFinite(value) ? fn(value) : String(value ?? '')
      )
    }
  }
  return instance
}

/**
 * Сигнатура t() для чистых модулей (analysis и др.): t передаётся значением.
 * Тип i18next — type-only, рантайм-зависимости это не добавляет.
 */
export type TranslateFn = TFunction<'translation', never>