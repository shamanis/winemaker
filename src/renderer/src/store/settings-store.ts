import { create } from 'zustand'
import type { AppSettings } from '@shared/ipc/contracts'
import type { Language } from '@shared/i18n/resolve-language'
import { api } from '../api'

interface SettingsStoreState {
  settings: AppSettings | null
  /** Эффективный язык интерфейса, вычисленный main (design D4). */
  resolvedLanguage: Language | null
  /** Загрузка уже полученных настроек — bootstrap вызывает без повторного IPC. */
  load(settings: AppSettings, resolvedLanguage: Language): void
  init(): Promise<void>
  update(patch: Partial<AppSettings>): Promise<void>
}

/**
 * Настройки приложения (спека application-settings): единицы плотности,
 * формула коррекции рефрактометра и язык интерфейса. Переживают
 * перезапуск (app_state); язык приходит из main уже вычисленным.
 */
export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: null,
  resolvedLanguage: null,

  load(settings, resolvedLanguage) {
    set({ settings, resolvedLanguage })
  },

  async init() {
    const { settings, resolvedLanguage } = await api.settings.get()
    if (!get().settings) set({ settings, resolvedLanguage })
  },

  async update(patch) {
    const current = get().settings
    if (!current) return
    const next = { ...current, ...patch }
    set({ settings: next })
    // main сохраняет настройки, возвращает эффективный язык (сам переключает
    // своё меню и каталог); renderer синхронизируется по подписке на это поле.
    const { resolvedLanguage } = await api.settings.set(next)
    set({ resolvedLanguage })
  }
}))
