/**
 * Единая конвенция времени приложения: все временные метки — ISO-8601 UTC.
 */

const ISO_8601_UTC_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

/** Проверяет, что строка — валидная ISO-8601 UTC-метка (суффикс Z). */
export function isUtcIso(value: string): boolean {
  if (!ISO_8601_UTC_RE.test(value)) return false
  const ms = Date.parse(value)
  return Number.isFinite(ms)
}

/** Текущий момент в ISO-8601 UTC. */
export function nowUtcIso(): string {
  return new Date().toISOString()
}

/** Приводит Date к ISO-8601 UTC (вход в любой таймзоне). */
export function toUtcIso(date: Date): string {
  return date.toISOString()
}

/** Разбирает ISO-8601 UTC-метку; бросает RangeError на невалидной строке. */
export function parseUtcIso(value: string): Date {
  if (!isUtcIso(value)) {
    throw new RangeError(`Not an ISO-8601 UTC timestamp: ${value}`)
  }
  return new Date(Date.parse(value))
}
