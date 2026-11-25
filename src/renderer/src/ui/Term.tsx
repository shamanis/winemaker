import type { ReactElement } from 'react'
import { GLOSSARY } from '../help/glossary'
import { useUiStore } from '../store/ui-store'

/**
 * Термин с подсказкой при наведении (спека 6.4.1): пунктирное
 * подчёркивание; клик открывает таб Справка.
 */
export function Term(props: { id: string; children?: ReactElement | string }): ReactElement {
  const setTab = useUiStore((s) => s.setTab)
  const text = GLOSSARY[props.id] ?? props.id
  return (
    <abbr
      className="term"
      title={text}
      role="button"
      tabIndex={0}
      onClick={() => setTab('help')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') setTab('help')
      }}
    >
      {props.children ?? props.id}
    </abbr>
  )
}
