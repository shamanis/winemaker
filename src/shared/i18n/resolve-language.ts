/**
 * Язык интерфейса (спека localization): поддерживаемые коды и
 * определение эффективного языка из настройки и языка системы.
 * Чистый модуль без i18next — используется и в contracts, и в main.
 */

/** Коды поддерживаемых языков (новый язык = каталог + строка здесь и в locales). */
export const LANGUAGE_CODES = ['ru', 'en'] as const
export type Language = (typeof LANGUAGE_CODES)[number]

/** Значения настройки языка: явный код или следование системе. */
export const LANGUAGE_SETTING_VALUES = ['system', ...LANGUAGE_CODES] as const
export type LanguageSetting = (typeof LANGUAGE_SETTING_VALUES)[number]

/** Явно выбранный код языка. */
export function isLanguageCode(value: string): value is Language {
  return (LANGUAGE_CODES as readonly string[]).includes(value)
}

/**
 * Эффективный язык интерфейса. Явный выбор важнее языка системы;
 * «system» — русский для систем с русским языком, английский для остальных
 * (спека localization: язык по умолчанию).
 */
export function resolveLanguage(setting: LanguageSetting, osLocale: string | undefined): Language {
  if (setting !== 'system') {
    return isLanguageCode(setting) ? setting : 'en'
  }
  const base = (osLocale ?? '').toLowerCase().split(/[-_]/)[0]
  return base === 'ru' ? 'ru' : 'en'
}
