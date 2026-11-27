import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '../store/ui-store'

/**
 * Термин с подсказкой при наведении (спека 6.4.1): пунктирное
 * подчёркивание; клик открывает таб Справка. Определение — из каталога
 * переводов (help.termDesc.*).
 */
export function Term(props: { id: string; children?: ReactElement | string }): ReactElement {
  const { t } = useTranslation()
  const setTab = useUiStore((s) => s.setTab)
  const text = t(`help.termDesc.${props.id}`, { defaultValue: props.id })
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
      {props.children ?? t(`help.term.${props.id}`, { defaultValue: props.id })}
    </abbr>
  )
}
