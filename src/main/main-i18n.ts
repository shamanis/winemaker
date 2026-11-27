import { createI18n, type TranslateFn } from '../shared/i18n/create-i18n'
import type { Language } from '../shared/i18n/resolve-language'

/**
 * Экземпляр i18next main-процесса (design D3): нативное меню, заголовок
 * диалога экспорта и готовый текст следа при сохранении замера.
 * Язык выставляет main при старте по настройке и при её смене.
 */
const instance = createI18n('ru')

export function setMainLanguage(language: Language): void {
  void instance.changeLanguage(language)
}

/** t() с текущим языком main — вызывается в момент записи, не захоранивается. */
export function mainT(): TranslateFn {
  return instance.t
}
