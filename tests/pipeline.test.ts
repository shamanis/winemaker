import { describe, expect, it } from 'vitest'
import { resolveMeasurement } from '../src/shared/calculations/pipeline'
import { brixToSg } from '../src/shared/calculations/density'

const BASE_CTX = {
  correctionFormula: 'terrill' as const,
  startCorrectedBrix: 22.88,
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

  it('рефрактометр на бродящем суле: Террилл по Bi из партии + предупреждение без пары', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 10, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      {
        ...BASE_CTX,
        instrument: { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetSg: null, hasCalibrationPair: false }
      }
    )
    // WCF: 10 × 1.04 = 10.4 corrected Brix
    expect(r.correctedBrix).toBeCloseTo(10.4, 8)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('усреднённому коэффициенту')
    const types = r.corrections.map((c) => c.type)
    expect(types).toEqual(['wcf', 'fermentation-correction'])
    // Bf=10.4, Bi=22.88 → Террилл
    const expected =
      1 -
      0.0044993 * 22.88 +
      0.011774 * 10.4 +
      0.00027581 * 22.88 ** 2 -
      0.0012717 * 10.4 ** 2 -
      0.00000728 * 22.88 ** 3 +
      0.000063293 * 10.4 ** 3
    expect(r.correctedSg).toBeCloseTo(expected, 10)
  })

  it('линейная формула из настроек даёт другой SG, чем Террилл', () => {
    const input = {
      kind: 'density' as const,
      rawValue: 10,
      unit: 'brix' as const,
      tempC: null,
      measuredAtUtc: '2026-11-26T11:00:00.000Z'
    }
    const instrument = { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetSg: null, hasCalibrationPair: true }
    const terrill = resolveMeasurement(input, { ...BASE_CTX, instrument, correctionFormula: 'terrill' })
    const linear = resolveMeasurement(input, { ...BASE_CTX, instrument, correctionFormula: 'linear' })
    expect(linear.correctedSg).not.toBeCloseTo(terrill.correctedSg as number, 4)
    // Баллинг: RE = 0.1808×22.88 + 0.8192×10.4
    const re = 0.1808 * 22.88 + 0.8192 * 10.4
    expect(linear.correctedSg).toBeCloseTo(
      1 + re / (258.6 - (re / 258.2) * 227.1),
      10
    )
  })

  it('замер до/в момент постановки — без ферментной коррекции', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 22, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-25T10:00:00.000Z' },
      { ...BASE_CTX, instrument: { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetSg: null, hasCalibrationPair: true } }
    )
    expect(r.corrections.map((c) => c.type)).toEqual(['wcf', 'brix-to-sg'])
  })

  it('Bi вычисляется инверсией, если старт партии был в SG', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 10, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      {
        correctionFormula: 'terrill',
        startCorrectedBrix: null,
        startOgSg: 1.0922,
        batchStartDateUtc: '2026-11-25T10:00:00.000Z',
        instrument: { type: 'refractometer-atc', wcf: 1, calibrationOffsetSg: null, hasCalibrationPair: true }
      }
    )
    const note = r.corrections.find((c) => c.type === 'fermentation-correction')?.note ?? ''
    expect(note).toContain('Bi=')
    expect(r.correctedSg).toBeGreaterThan(0.99)
    expect(r.correctedSg).toBeLessThan(1.02)
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
