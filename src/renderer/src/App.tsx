import { useEffect, useRef, type ReactElement } from 'react'
import { useAppStore } from './store/app-store'
import { useUiStore, TAB_ORDER, type ScreenTab } from './store/ui-store'
import { useSettingsStore } from './store/settings-store'
import { BatchesScreen } from './screens/BatchesScreen'
import { CatalogsScreen } from './screens/CatalogsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { GlossaryScreen } from './screens/GlossaryScreen'
import { HOTKEYS } from './keyboard/hotkeys'
import { useHotkeys } from './keyboard/use-hotkeys'

const TAB_LABELS: Record<ScreenTab, string> = {
  batches: 'Партии',
  catalogs: 'Справочники',
  settings: 'Настройки',
  help: 'Справка'
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
    // Единицы плотности нужны на всех экранах (форматтеры) — грузим сразу.
    void useSettingsStore.getState().init()
  }, [bootstrap, initUi])

  useHotkeys({
    [HOTKEYS.toggleTheme]: toggleTheme,
    [HOTKEYS.batches]: () => setTab('batches'),
    [HOTKEYS.catalogs]: () => setTab('catalogs'),
    [HOTKEYS.settings]: () => setTab('settings'),
    [HOTKEYS.help]: () => setTab('help')
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
          aria-label={theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
          title={`${HOTKEYS.toggleTheme} — переключить тему`}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? (
            /* солнышко: клик переключит на светлую */
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="12" cy="12" r="4.4" fill="currentColor" />
              <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="12" y1="2.2" x2="12" y2="4.6" />
                <line x1="12" y1="19.4" x2="12" y2="21.8" />
                <line x1="2.2" y1="12" x2="4.6" y2="12" />
                <line x1="19.4" y1="12" x2="21.8" y2="12" />
                <line x1="4.8" y1="4.8" x2="6.5" y2="6.5" />
                <line x1="17.5" y1="17.5" x2="19.2" y2="19.2" />
                <line x1="4.8" y1="19.2" x2="6.5" y2="17.5" />
                <line x1="17.5" y1="6.5" x2="19.2" y2="4.8" />
              </g>
            </svg>
          ) : (
            /* полумесяц: клик переключит на тёмную */
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
                fill="currentColor"
              />
            </svg>
          )}
        </button>
      </header>

      <main className="app-main">
        {activeTab === 'batches' ? <BatchesScreen /> : null}
        {activeTab === 'catalogs' ? <CatalogsScreen /> : null}
        {activeTab === 'settings' ? <SettingsScreen /> : null}
        {activeTab === 'help' ? <GlossaryScreen /> : null}
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
