import { useEffect, useRef, type ReactElement } from 'react'
import { useAppStore } from './store/app-store'
import { useUiStore, TAB_ORDER, type ScreenTab } from './store/ui-store'
import { BatchesScreen } from './screens/BatchesScreen'
import { CatalogsScreen } from './screens/CatalogsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { HOTKEYS } from './keyboard/hotkeys'
import { useHotkeys } from './keyboard/use-hotkeys'

const TAB_LABELS: Record<ScreenTab, string> = {
  batches: 'Партии',
  catalogs: 'Справочники',
  settings: 'Настройки'
}

export function App(): ReactElement {
  const bootstrap = useAppStore((s) => s.bootstrap)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const theme = useAppStore((s) => s.theme)
  const utilityOk = useAppStore((s) => s.utilityOk)
  const appVersion = useAppStore((s) => s.appVersion)

  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const initUi = useUiStore((s) => s.init)
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    void bootstrap()
    void initUi()
  }, [bootstrap, initUi])

  useHotkeys({
    [HOTKEYS.toggleTheme]: toggleTheme,
    [HOTKEYS.batches]: () => setTab('batches'),
    [HOTKEYS.catalogs]: () => setTab('catalogs'),
    [HOTKEYS.settings]: () => setTab('settings')
  })

  /** Roving tabindex: стрелки перемещают фокус по табам. */
  const onTabKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const idx = TAB_ORDER.indexOf(activeTab)
    const next =
      event.key === 'ArrowRight'
        ? (idx + 1) % TAB_ORDER.length
        : (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length
    const nextTab = TAB_ORDER[next]
    if (nextTab) {
      setTab(nextTab)
      tabsRef.current[next]?.focus()
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Winemaker</h1>
        <nav className="tabs" role="tablist" aria-label="Разделы" onKeyDown={onTabKeyDown}>
          {TAB_ORDER.map((tab, idx) => (
            <button
              key={tab}
              ref={(el) => {
                tabsRef.current[idx] = el
              }}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              tabIndex={activeTab === tab ? 0 : -1}
              className={activeTab === tab ? 'tab active' : 'tab'}
              title={`${HOTKEYS[tab]} — ${TAB_LABELS[tab]}`}
              onClick={() => setTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </nav>
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
        {activeTab === 'batches' ? <BatchesScreen /> : null}
        {activeTab === 'catalogs' ? <CatalogsScreen /> : null}
        {activeTab === 'settings' ? <SettingsScreen /> : null}
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
