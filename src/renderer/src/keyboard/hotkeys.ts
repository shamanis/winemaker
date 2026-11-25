/**
 * Единый реестр горячих клавиш. Добавление нового действия — только здесь
 * (design.md D7): разбросанные по компонентам комбинации запрещены.
 */
export const HOTKEYS = {
  /** Переключение светлой/тёмной темы. */
  toggleTheme: 'Mod+Shift+L'
} as const

export type HotkeyAction = keyof typeof HOTKEYS
