import { describe, expect, it } from 'vitest'
import {
  apparentAttenuation,
  forecastCompletion,
  formatAbv,
  formatDensity,
  hallAbv,
  residualSugar
} from '../src/shared/calculations/analysis'
import { brixToSg } from '../src/shared/calculations/density'
import { invertBrixToSg } from '../src/shared/calculations/correction'

describe('hallAbv (формула Hall из vision)', () => {
  it('контрольный пример OG=1.092, FG=0.998', () => {
    const expected =
      ((76.08 * (1.092 - 0.998)) / (1.775 - 1.092)) * (0.998 / 0.794)
    expect(hallAbv(1.092, 0.998)).toBeCloseTo(expected, 10)
    expect(hallAbv(1.092, 0.998)).toBeGreaterThan(13.0)
    expect(hallAbv(1.092, 0.998)).toBeLessThan(13.3)
  })

  it('OG=FG → 0 % об.', () => {
    expect(hallAbv(1.09, 1.09)).toBe(0)
  })
})

describe('сбраживание и остаточный сахар', () => {
  it('видимая степень сбраживания', () => {
    expect(apparentAttenuation(1.092, 1.0)).toBeCloseTo(
      ((1.092 - 1.0) / 0.092) * 100,
      10
    )
  })

  it('остаточный сахар: Баллинг RE × FG × 10', () => {
    const og = 1.092
    const fg = 1.01
    const rs = residualSugar(og, fg)
    expect(rs).toBeGreaterThan(0)
    // Полусухое вино ~ 5–40 г/л в разумном диапазоне
    expect(rs).toBeLessThan(100)
  })
})

describe('forecastCompletion (прогноз-диапазон, спека 6.3.6)', () => {
  const day = (n: number, hh = 12): string =>
    `2026-11-2${n}T${hh}:00:00.000Z`

  it('падающая динамика даёт диапазон [min, max+1 сутки]', () => {
    const f = forecastCompletion([
      { atUtc: day(3), sg: 1.09 },
      { atUtc: day(4), sg: 1.07 },
      { atUtc: day(5), sg: 1.05 },
      { atUtc: day(6), sg: 1.03 }
    ])
    expect(f.kind).toBe('range')
    if (f.kind === 'range') {
      expect(Date.parse(f.fromUtc)).toBeLessThanOrEqual(Date.parse(f.toUtc))
      // Оба ETA после последней точки (целевая 0.999 ещё не достигнута)
      expect(Date.parse(f.fromUtc)).toBeGreaterThan(Date.parse(day(6)))
    }
  })

  it('меньше 3 точек — недостаточно данных', () => {
    const f = forecastCompletion([
      { atUtc: day(3), sg: 1.09 },
      { atUtc: day(4), sg: 1.07 }
    ])
    expect(f.kind).toBe('insufficient-data')
  })

  it('окно меньше 48 часов — недостаточно данных', () => {
    const f = forecastCompletion([
      { atUtc: '2026-11-25T10:00:00.000Z', sg: 1.09 },
      { atUtc: '2026-11-25T20:00:00.000Z', sg: 1.08 },
      { atUtc: '2026-11-26T06:00:00.000Z', sg: 1.07 }
    ])
    expect(f.kind).toBe('insufficient-data')
  })

  it('плоская динамика — прогноз не строится', () => {
    const f = forecastCompletion([
      { atUtc: day(3), sg: 1.05 },
      { atUtc: day(4), sg: 1.05 },
      { atUtc: day(5), sg: 1.05 },
      { atUtc: day(6), sg: 1.05 }
    ])
    expect(f.kind).toBe('not-declining')
  })
})

describe('форматтеры (6.3.1, 6.3.2)', () => {
  it('крепость всегда с «% об.»', () => {
    expect(formatAbv(12.34)).toContain('% об.')
    expect(formatAbv(null)).toBe('—')
  })

  it('плотность показывает ОБЕ единицы при любом значении настроек', () => {
    const sg = brixToSg(22)
    const asBrix = formatDensity(sg, 'brix')
    expect(asBrix).toContain('°Bx')
    expect(asBrix).toContain('SG')
    // рабочая единица первой, вторая в скобках
    expect(asBrix.startsWith(`${invertBrixToSg(sg).toFixed(1)} °Bx (`)).toBe(true)

    const asSg = formatDensity(1.0959, 'sg')
    expect(asSg).toBe('1.0959 SG (22.9 °Bx)')
    expect(formatDensity(null, 'sg')).toBe('—')
  })
})
