import type { IpcErrorDto } from './contracts'
import { AppError } from './errors'

/**
 * Сборка конверта ошибки (design D8) — чистая функция без electron,
 * чтобы покрыть тестом. Доменные ошибки несут ключ каталога; встроенные
 * ошибки zod без доменного сообщения попадают в issues без ключа —
 * интерфейс покажет общее локализованное сообщение.
 */

/** Доменные сообщения zod и AppError живут под errors.* в каталоге. */
const DOMAIN_KEY_RE = /^errors\.[\w-]+(?:\.[\w-]+)*$/

export function isDomainKey(message: string): boolean {
  return DOMAIN_KEY_RE.test(message)
}

/** Ключ каталога для issue проверки ввода, если сообщение доменное. */
export function issueKey(message: string): string | undefined {
  return isDomainKey(message) ? message : undefined
}

export function toErrorEnvelope(error: unknown): IpcErrorDto {
  if (error instanceof AppError) {
    return {
      code: 'DOMAIN',
      message: error.key,
      key: error.key,
      params: error.params
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'INTERNAL', message }
}
