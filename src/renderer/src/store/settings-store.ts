import { create } from 'zustand'
import type { AppSettings } from '@shared/ipc/contracts'
import { api } from '../api'

interface SettingsStoreState {
  settings: AppSettings | null
  init(): Promise<void>
  update(patch: Partial<AppSettings>): Promise<void>
}

/**
 * Настройки приложения (спека application-settings): единицы плотности
 * и формула коррекции рефрактометра. Переживают перезапуск (app_state).
 */
export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: null,

  async init() {
    const settings = await api.settings.get()
    set({ settings })
  },

  async update(patch) {
    const current = get().settings
    if (!current) return
    const next = { ...current, ...patch }
    set({ settings: next })
    await api.settings.set(next)
  }
}))
