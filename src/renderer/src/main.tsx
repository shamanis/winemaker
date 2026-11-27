import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { App } from './App'
import { i18n, setRendererLanguage } from './i18n'
import { useSettingsStore } from './store/settings-store'
import { api } from './api'
import { resolveLanguage, type Language } from '@shared/i18n/resolve-language'
import './styles/themes.css'
import './styles/base.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('#root not found')
}

/**
 * Bootstrap до первой отрисовки (design D4): язык из настроек (или системы,
 * если IPC ещё не готов) выставляется заранее — интерфейс не мигает языком.
 */
async function bootstrap(): Promise<void> {
  if (!container) {
    throw new Error('#root not found')
  }
  let language: Language = resolveLanguage('system', navigator.language)
  try {
    const { settings, resolvedLanguage } = await api.settings.get()
    language = resolvedLanguage
    // Настройки уже в руках — отдаём стору без второго запроса.
    useSettingsStore.getState().load(settings, resolvedLanguage)
  } catch {
    // main ещё не отвечает — остаётся язык системы.
  }
  setRendererLanguage(language)

  createRoot(container).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </StrictMode>
  )
}

void bootstrap()
