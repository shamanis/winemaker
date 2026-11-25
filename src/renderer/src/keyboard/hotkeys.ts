/**
 * Единый реестр горячих клавиш. Добавление нового действия — только здесь
 * (design.md D7): разбросанные по компонентам комбинации запрещены.
 */
export const HOTKEYS = {
  /** Переключение светлой/тёмной темы. */
  toggleTheme: 'Mod+Shift+L',
  /** Экран партий. */
  batches: 'Mod+1',
  /** Экран справочников. */
  catalogs: 'Mod+2',
  /** Экран настроек. */
  settings: 'Mod+3',
  /** Экран справки. */
  help: 'Mod+4'
} as const

export type HotkeyAction = keyof typeof HOTKEYS
