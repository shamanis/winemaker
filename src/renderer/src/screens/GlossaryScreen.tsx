import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { GLOSSARY_ORDER, FORMULA_IDS } from '../help/glossary'

/**
 * Экран «Справка» (спека glossary): глоссарий + формулы из vision,
 * доступ без выхода из приложения (6.4.3). Тексты и записи формул —
 * из каталога переводов.
 */
export function GlossaryScreen(): ReactElement {
  const { t } = useTranslation()
  return (
    <section className="screen">
      <h2>{t('help.title')}</h2>

      <h3 className="help-heading">{t('help.glossaryTitle')}</h3>
      <dl className="help-list">
        {GLOSSARY_ORDER.map((id) => (
          <div key={id} className="help-item">
            <dt>{t(`help.term.${id}`)}</dt>
            <dd>{t(`help.termDesc.${id}`)}</dd>
          </div>
        ))}
      </dl>

      <h3 className="help-heading">{t('help.formulasTitle')}</h3>
      <div className="help-formulas">
        {FORMULA_IDS.map((id) => (
          <div key={id} className="card">
            <h4>{t(`help.formulas.${id}.title`)}</h4>
            <code className="formula">{t(`help.formulas.${id}.formula`)}</code>
            <p className="muted">{t(`help.formulas.${id}.note`)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

