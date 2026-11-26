import { describe, expect, it } from 'vitest'
import { resolveMeasurement } from '../src/shared/calculations/pipeline'
import { invertBrixToSg } from '../src/shared/calculations/correction'
import { brixToSg } from '../src/shared/calculations/density'

const BASE_CTX = {
  correctionFormula: 'terrill' as const,
  startRawGravity: { value: 22, unit: 'brix' as const },
  startOgSg: 1.0919540,
  batchStartDateUtc: '2026-11-25T10:00:00.000Z'
}

describe('resolveMeasurement — пайплайн коррекции', () => {
  it('temperature/ph: значение как есть, без коррекций', () => {
    const r = resolveMeasurement(
      { kind: 'ph', rawValue: 3.4, unit: 'sg', measuredAtUtc: '2026-11-25T11:00:00.000Z' },
      { ...BASE_CTX, instrument: { type: 'hydrometer', wcf: null, calibrationOffsetSg: null } }
    )
    expect(r.correctedSg).toBeNull()
    expect(r.corrections).toHaveLength(0)
  })

  it('ареометр SG + температура: темп-коррекция и смещение в следе', () => {
    const r = resolveMeasurement(
      {
        kind: 'density',
        rawValue: 1.09,
        unit: 'sg',
        tempC: 28,
        measuredAtUtc: '2026-11-25T11:00:00.000Z'
      },
      {
        ...BASE_CTX,
        instrument: {
          type: 'hydrometer',
          wcf: null,
          calibrationOffsetSg: 0.002,
          calibrationTempC: 20
        }
      }
    )
    expect(r.corrections.map((c) => c.type)).toEqual(['hydrometer-temp', 'calibration-offset'])
    // 1.09 × (1+3.7e-4×8) = 1.0932264 → +0.002
    expect(r.correctedSg).toBeCloseTo(1.0932264 + 0.002, 8)
    expect(r.warnings).toHaveLength(0)
  })

  it('ареометр в Brix: сначала перевод в SG, потом температура', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 22, unit: 'brix', tempC: 20, measuredAtUtc: '2026-11-25T11:00:00.000Z' },
      { ...BASE_CTX, instrument: { type: 'hydrometer', wcf: null, calibrationOffsetSg: null, calibrationTempC: 20 } }
    )
    expect(r.corrections[0]?.type).toBe('brix-to-sg')
    expect(r.correctedSg).toBeCloseTo(brixToSg(22), 10)
  })

  it('предупреждение вне зоны 10–35 °C', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 1.05, unit: 'sg', tempC: 38, measuredAtUtc: '2026-11-25T11:00:00.000Z' },
      { ...BASE_CTX, instrument: { type: 'hydrometer', wcf: null, calibrationOffsetSg: null } }
    )
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('вне зоны аппроксимации')
  })

  it('рефрактометр на бродящем суле: Террилл на СЫРЫХ показаниях + предупреждение без пары', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 14, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      {
        ...BASE_CTX,
        instrument: { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetSg: null, hasCalibrationPair: false }
      }
    )
    // WCF к текущему показанию НЕ применяется (регрессия Террилла на сырых)
    expect(r.correctedBrix).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('усреднённой формуле')
    const types = r.corrections.map((c) => c.type)
    expect(types).toEqual(['fermentation-correction'])
    // Bi=22, Bf=14 сырые → пользовательский контрольный пример ≈ 11.5 °Bx / 1.0462 SG
    const expected =
      1 -
      0.0044993 * 22 +
      0.011774 * 14 +
      0.00027581 * 22 ** 2 -
      0.0012717 * 14 ** 2 -
      0.00000728 * 22 ** 3 +
      0.000063293 * 14 ** 3
    expect(r.correctedSg).toBeCloseTo(expected, 10)
    expect(r.correctedSg).toBeGreaterThan(1.045)
    expect(r.correctedSg).toBeLessThan(1.047)
  })

  it('линейная формула: OE из истинного OG, AE из сырого показания', () => {
    const input = {
      kind: 'density' as const,
      rawValue: 14,
      unit: 'brix' as const,
      tempC: null,
      measuredAtUtc: '2026-11-26T11:00:00.000Z'
    }
    const instrument = { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetSg: null, hasCalibrationPair: true }
    const terrill = resolveMeasurement(input, { ...BASE_CTX, instrument, correctionFormula: 'terrill' })
    const linear = resolveMeasurement(input, { ...BASE_CTX, instrument, correctionFormula: 'linear' })
    expect(linear.correctedSg).not.toBeCloseTo(terrill.correctedSg as number, 4)
    // Баллинг: OE = invert(1.0919540), AE = invert(brixToSg(14))
    const oe = invertBrixToSg(1.0919540)
    const ae = invertBrixToSg(brixToSg(14))
    const re = 0.1808 * oe + 0.8192 * ae
    expect(linear.correctedSg).toBeCloseTo(
      1 + re / (258.6 - (re / 258.2) * 227.1),
      10
    )
  })

  it('ранняя стадия (Bf близко к Bi): Террилл экстраполирует абсурд — fallback на сахарный эквивалент', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 18, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      {
        ...BASE_CTX,
        instrument: { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetSg: null, hasCalibrationPair: true }
      }
    )
    // Террилл(22, 18.72) = 1.126 > OG 1.0959 — физически невозможно
    const types = r.corrections.map((c) => c.type)
    expect(types).toContain('early-fermentation-fallback')
    expect(r.correctedSg).toBeLessThanOrEqual(1.09595)
    expect(r.correctedSg).toBeCloseTo(brixToSg(18 * 1.04), 8) // 1.0777
    expect(r.warnings.some((w) => w.includes('близок к стартовому'))).toBe(true)
  })

  it('замер до/в момент постановки — без ферментной коррекции', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 22, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-25T10:00:00.000Z' },
      { ...BASE_CTX, instrument: { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetSg: null, hasCalibrationPair: true } }
    )
    expect(r.corrections.map((c) => c.type)).toEqual(['wcf', 'brix-to-sg'])
  })

  it('Bi из сырого показания старта; старт в SG — Bi инверсией из OG', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 10, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      {
        correctionFormula: 'terrill',
        startRawGravity: { value: 1.0922, unit: 'sg' },
        startOgSg: 1.0922,
        batchStartDateUtc: '2026-11-25T10:00:00.000Z',
        instrument: { type: 'refractometer-atc', wcf: 1, calibrationOffsetSg: null, hasCalibrationPair: true }
      }
    )
    const note = r.corrections.find((c) => c.type === 'fermentation-correction')?.note ?? ''
    expect(note).toContain('Bi=')
    // Террилл(Bi=21.97 инверсией, Bf=10) — разумный FG
    expect(r.correctedSg).toBeGreaterThan(1.0)
    expect(r.correctedSg).toBeLessThan(1.03)
  })

  it('плотность без прибора — ошибка (глубокая защита за zod)', () => {
    expect(() =>
      resolveMeasurement(
        { kind: 'density', rawValue: 1.09, unit: 'sg', measuredAtUtc: '2026-11-26T11:00:00.000Z' },
        { ...BASE_CTX, instrument: null as never }
      )
    ).toThrow(TypeError)
  })
})
