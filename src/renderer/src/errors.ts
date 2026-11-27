import { IpcError } from '@shared/ipc/errors'
import type { TranslateFn } from '@shared/i18n/create-i18n'

/**
 * Человекочитаемое сообщение об ошибке на языке интерфейса (design D8):
 * доменные ошибки — по ключу каталога; встроенные проверки zod — общее
 * сообщение с полем; остальное — общее сообщение (детали — в консоли).
 */
export function describeError(e: unknown, t: TranslateFn): string {
  if (e instanceof IpcError) {
    if (e.key) return t(e.key, { ...e.params })
    const fieldIssue = e.issues?.find((i) => i.key)
    if (fieldIssue?.key) {
      return fieldIssue.path ? `${fieldIssue.path}: ${t(fieldIssue.key)}` : t(fieldIssue.key)
    }
    if (e.issues?.length) return t('errors.validation')
  }
  console.error(e)
  return t('errors.generic')
}
