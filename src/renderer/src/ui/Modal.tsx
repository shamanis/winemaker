import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Единая модалка приложения: Escape и клик по фону закрывают, Tab не
 * выходит за пределы диалога, фокус на первый контрол при открытии.
 * Все диалоги строятся на нём (design: ui primitives layer).
 *
 * Рендерится порталом в document.body: модалка не должна оказаться
 * внутри <form> вызывающего экрана — вложенная форма ломает обработку
 * submit (React не получает событие, и страница уходит в перезагрузку).
 */
export function Modal(props: {
  title: string
  onClose(): void
  children: ReactNode
  wide?: boolean
}): ReactElement {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      // Focus trap: Tab циклически ходит по контролам диалога.
      const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('disabled')
      )
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables.at(-1)!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className={props.wide ? 'modal modal-wide' : 'modal'}
      >
        <h3>{props.title}</h3>
        {props.children}
      </div>
    </div>,
    document.body
  )
}
