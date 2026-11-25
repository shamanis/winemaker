import { create } from 'zustand'
import { api } from '../api'

export type ScreenTab = 'batches' | 'catalogs' | 'settings' | 'help'

interface UiStoreState {
  activeTab: ScreenTab
  init(): Promise<void>
  setTab(tab: ScreenTab): void
}

const TAB_ORDER: ScreenTab[] = ['batches', 'catalogs', 'settings', 'help']

function isScreenTab(value: unknown): value is ScreenTab {
  return typeof value === 'string' && TAB_ORDER.includes(value as ScreenTab)
}

/**
 * Активный экран оболочки. Сохраняется в app_state — состояние
 * представления переживает перезапуск (спека ui-shell).
 */
export const useUiStore = create<UiStoreState>((set) => ({
  activeTab: 'batches',

  async init() {
    try {
      const stored = await api.appStateGet('activeTab')
      if (isScreenTab(stored)) set({ activeTab: stored })
    } catch {
      // Дефолтный таб остаётся.
    }
  },

  setTab(tab: ScreenTab) {
    set({ activeTab: tab })
    void api.appStateSet('activeTab', tab)
  }
}))

export { TAB_ORDER }
