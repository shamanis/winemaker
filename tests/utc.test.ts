import { describe, expect, it } from 'vitest'
import {
  isUtcIso,
  nowUtcIso,
  parseUtcIso,
  toUtcIso
} from '../src/shared/time/utc'

describe('UTC-конвенция', () => {
  it('nowUtcIso возвращает валидную ISO-8601 UTC-метку', () => {
    const iso = nowUtcIso()
    expect(isUtcIso(iso)).toBe(true)
  })

  it('toUtcIso приводит вход в положительной таймзоне к UTC', () => {
    expect(toUtcIso(new Date('2026-01-02T03:04:05+05:00'))).toBe(
      '2026-01-01T22:04:05.000Z'
    )
  })

  it('toUtcIso приводит вход в отрицательной таймзоне к UTC', () => {
    expect(toUtcIso(new Date('2026-01-01T03:04:05-08:00'))).toBe(
      '2026-01-01T11:04:05.000Z'
    )
  })

  it('isUtcIso отклоняет метки без Z и мусор', () => {
    expect(isUtcIso('2026-01-01T00:00:00+03:00')).toBe(false)
    expect(isUtcIso('not-a-date')).toBe(false)
    expect(isUtcIso('')).toBe(false)
  })

  it('parseUtcIso разбирает валидную метку и бросает RangeError на невалидной', () => {
    expect(parseUtcIso('2026-01-01T00:00:00.000Z').getTime()).toBe(
      Date.parse('2026-01-01T00:00:00.000Z')
    )
    expect(() => parseUtcIso('2026-01-01')).toThrow(RangeError)
  })
})
