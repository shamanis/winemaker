import { useEffect, useRef } from 'react'

export type HotkeyMap = Record<string, () => void>

/** Парсер комбинаций вида `Mod+Shift+L` (Mod = Cmd/Ctrl). */
export function matchesCombo(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop()
  if (!key) return false

  const want = {
    mod: parts.includes('mod'),
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt')
  }
  const modPressed = event.metaKey || event.ctrlKey

  return (
    event.key.toLowerCase() === key &&
    (want.mod ? modPressed : !modPressed) &&
    (want.ctrl ? event.ctrlKey : true) &&
    (want.shift ? event.shiftKey : !event.shiftKey) &&
    (want.alt ? event.altKey : !event.altKey)
  )
}

/**
 * Подключает карту хоткеев на время жизни компонента.
 * Карта хранится в ref — ререндеры не переподписывают listener.
 */
export function useHotkeys(map: HotkeyMap): void {
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      for (const [combo, action] of Object.entries(mapRef.current)) {
        if (matchesCombo(event, combo)) {
          event.preventDefault()
          action()
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
