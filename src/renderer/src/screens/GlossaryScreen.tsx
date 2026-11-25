import type { ReactElement } from 'react'
import { GLOSSARY, GLOSSARY_ORDER, FORMULAS } from '../help/glossary'

const GLOSSARY_LABELS: Record<string, string> = {
  sg: 'SG',
  og: 'OG',
  fg: 'FG',
  brix: 'Brix (°Bx)',
  atc: 'ATC',
  wcf: 'WCF',
  abv: 'ABV',
  ph: 'pH',
  tcal: 'T_кал',
  ferment: 'Брожение'
}

/**
 * Экран «Справка» (спека glossary): глоссарий + формулы из vision,
 * доступ без выхода из приложения (6.4.3).
 */
export function GlossaryScreen(): ReactElement {
  return (
    <section className="screen">
      <h2>Справка</h2>

      <h3 className="help-heading">Глоссарий</h3>
      <dl className="help-list">
        {GLOSSARY_ORDER.map((id) => (
          <div key={id} className="help-item">
            <dt>{GLOSSARY_LABELS[id] ?? id}</dt>
            <dd>{GLOSSARY[id]}</dd>
          </div>
        ))}
      </dl>

      <h3 className="help-heading">Формулы</h3>
      <div className="help-formulas">
        {FORMULAS.map((f) => (
          <div key={f.title} className="card">
            <h4>{f.title}</h4>
            <code className="formula">{f.formula}</code>
            <p className="muted">{f.note}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
