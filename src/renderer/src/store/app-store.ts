import { create } from 'zustand'
import { api } from '../api'

export type Theme = 'light' | 'dark'

interface AppStoreState {
  /** null — пока тема не загружена из app_state. */
  theme: Theme | null
  utilityOk: boolean | null
  appVersion: string | null
  ready: boolean
  bootstrap(): Promise<void>
  toggleTheme(): void
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme
}

/**
 * Состояние оболочки: тема + статус служб. Доменные сторы появятся
 * в последующих change; этот — только каркас ui-shell.
 */
export const useAppStore = create<AppStoreState>((set, get) => ({
  theme: null,
  utilityOk: null,
  appVersion: null,
  ready: false,

  async bootstrap() {
    try {
      const [health, storedTheme] = await Promise.all([
        api.health(),
        api.appStateGet('theme')
      ])
      const theme: Theme =
        storedTheme === 'light' || storedTheme === 'dark'
          ? storedTheme
          : window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
      applyTheme(theme)
      set({
        theme,
        utilityOk: health.utilityEcho === 'ping',
        appVersion: health.appVersion,
        ready: true
      })
    } catch {
      // Даже при отказе служб приложение остаётся пригодным для работы.
      applyTheme('light')
      set({ theme: 'light', utilityOk: false, ready: true })
    }
  },

  toggleTheme() {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    set({ theme: next })
    void api.appStateSet('theme', next)
  }
}))
