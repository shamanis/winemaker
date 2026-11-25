import type { ReactElement } from 'react'

/**
 * Пустое состояние главного экрана (ui-shell: «осмысленные пустые
 * состояния»). Кнопка создания партии — заглушка до доменного этапа.
 */
export function EmptyState(): ReactElement {
  return (
    <section className="empty-state">
      <h2>Партий пока нет</h2>
      <p>
        Поставьте первую партию — замеры, операции и заметки будут
        собираться в единый журнал этой партии.
      </p>
      <button type="button" disabled title="Появится на следующем этапе">
        Новая партия
      </button>
    </section>
  )
}
