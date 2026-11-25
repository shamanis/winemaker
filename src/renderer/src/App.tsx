import { useEffect, type ReactElement } from 'react'
import { useAppStore } from './store/app-store'
import { EmptyState } from './ui/empty-state'
import { HOTKEYS } from './keyboard/hotkeys'
import { useHotkeys } from './keyboard/use-hotkeys'

export function App(): ReactElement {
  const bootstrap = useAppStore((s) => s.bootstrap)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const theme = useAppStore((s) => s.theme)
  const utilityOk = useAppStore((s) => s.utilityOk)
  const appVersion = useAppStore((s) => s.appVersion)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useHotkeys({ [HOTKEYS.toggleTheme]: toggleTheme })

  return (
    <div className="app">
      <header className="app-header">
        <h1>Winemaker</h1>
        <button
          type="button"
          className="theme-toggle"
          aria-label="Переключить тему"
          title={`${HOTKEYS.toggleTheme} — переключить тему`}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        </button>
      </header>

      <main className="app-main">
        <EmptyState />
      </main>

      <footer className="app-footer">
        <span>
          {utilityOk === null
            ? 'Проверка служб…'
            : utilityOk
              ? 'Службы: ок'
              : 'Службы: ошибка'}
        </span>
        {appVersion ? <span>v{appVersion}</span> : null}
      </footer>
    </div>
  )
}
