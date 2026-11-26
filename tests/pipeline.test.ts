import { describe, expect, it } from 'vitest'
import { resolveMeasurement } from '../src/shared/calculations/pipeline'
import { invertBrixToSg } from '../src/shared/calculations/correction'
import { brixToSg } from '../src/shared/calculations/density'

const BASE_CTX = {
  correctionFormula: 'terrill' as const,
  startRawGravity: { value: 22, unit: 'brix' as const },
  startOgSg: 1.0919540,
  startCorrectedBrix: 22.88, // 22 × 1.04 (WCF)
  batchStartDateUtc: '2026-11-25T10:00:00.000Z'
}

describe('resolveMeasurement — пайплайн коррекции', () => {
  it('temperature/ph: значение как есть, без коррекций', () => {
    const r = resolveMeasurement(
      { kind: 'ph', rawValue: 3.4, unit: 'sg', measuredAtUtc: '2026-11-25T11:00:00.000Z' },
      { ...BASE_CTX, instrument: { type: 'hydrometer', wcf: null, calibrationOffsetBx: null } }
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
          calibrationOffsetBx: 0.002,
          calibrationTempC: 20
        }
      }
    )
    expect(r.corrections.map((c) => c.type)).toEqual(['sg-to-brix', 'calibration-offset', 'hydrometer-temp'])
    // 1.09 SG → Bx → +0.002 °Bx → SG → темп-коррекция (28 − 20 = 8 °C)
    const sg0 = brixToSg(invertBrixToSg(1.09) + 0.002)
    expect(r.correctedSg).toBeCloseTo(sg0 * (1 + 3.7e-4 * 8), 8)
    expect(r.warnings).toHaveLength(0)
  })

  it('ареометр в Brix: темп-коррекция при T = T_кал ничего не меняет', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 22, unit: 'brix', tempC: 20, measuredAtUtc: '2026-11-25T11:00:00.000Z' },
      { ...BASE_CTX, instrument: { type: 'hydrometer', wcf: null, calibrationOffsetBx: null, calibrationTempC: 20 } }
    )
    expect(r.corrections[0]?.type).toBe('hydrometer-temp')
    expect(r.correctedSg).toBeCloseTo(brixToSg(22), 10)
    expect(r.correctedBrix).toBeCloseTo(22, 10)
  })

  it('предупреждение вне зоны 10–35 °C', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 1.05, unit: 'sg', tempC: 38, measuredAtUtc: '2026-11-25T11:00:00.000Z' },
      { ...BASE_CTX, instrument: { type: 'hydrometer', wcf: null, calibrationOffsetBx: null } }
    )
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('вне зоны аппроксимации')
  })

  it('ручной Террилл в домене (Bf ≤ 0.6·Bi): сырые показания, ручной WCF — без предупреждений', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 12, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      {
        ...BASE_CTX,
        correctionFormula: 'terrill',
        instrument: { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetBx: null, hasCalibrationPair: false }
      }
    )
    // WCF к текущему показанию НЕ применяется (регрессия Террилла на сырых)
    expect(r.correctedBrix).toBeNull()
    // Персональный WCF есть (задан вручную) — предупреждения о калибровке нет
    expect(r.warnings).toHaveLength(0)
    const types = r.corrections.map((c) => c.type)
    expect(types).toEqual(['fermentation-correction'])
    // Bi=22, Bf=12 сырые (12 ≤ 0.6×22=13.2 — в домене)
    const expected =
      1 -
      0.0044993 * 22 +
      0.011774 * 12 +
      0.00027581 * 22 ** 2 -
      0.0012717 * 12 ** 2 -
      0.00000728 * 22 ** 3 +
      0.000063293 * 12 ** 3
    expect(r.correctedSg).toBeCloseTo(expected, 10)
    expect(r.correctedSg).toBeGreaterThan(1.02)
    expect(r.correctedSg).toBeLessThan(1.03)
  })

  it('ручной Террилл вне домена (R > 0.6·OG): Novotný + информационное сообщение', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 14, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      {
        ...BASE_CTX,
        correctionFormula: 'terrill',
        instrument: { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetBx: null, hasCalibrationPair: false }
      }
    )
    // 14 > 13.2 = 0.6×22 — эвристика docs: вне домена → Novotný
    const types = r.corrections.map((c) => c.type)
    expect(types).toEqual(['novotny-model'])
    expect(r.correctedSg).toBeLessThanOrEqual(BASE_CTX.startOgSg)
    expect(r.infos.some((i) => i.includes('близко к стартовому'))).toBe(true)
    // ручной WCF 1.04 задан — предупреждения о калибровке нет
    expect(r.warnings).toHaveLength(0)
  })

  it('нет ни пары, ни ручного WCF: предупреждение о поправке ×1.0', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 12, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      {
        ...BASE_CTX,
        correctionFormula: 'terrill',
        instrument: { type: 'refractometer-atc', wcf: null, calibrationOffsetBx: null, hasCalibrationPair: false }
      }
    )
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('нет персонального WCF')
    expect(r.warnings[0]).toContain('без поправки')
  })

  it('линейная формула: OE из истинного OG, AE из сырого показания (в домене — 12 ≤ 13.2)', () => {
    const input = {
      kind: 'density' as const,
      rawValue: 12,
      unit: 'brix' as const,
      tempC: null,
      measuredAtUtc: '2026-11-26T11:00:00.000Z'
    }
    const instrument = { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetBx: null, hasCalibrationPair: true }
    const terrill = resolveMeasurement(input, { ...BASE_CTX, instrument, correctionFormula: 'terrill' })
    const linear = resolveMeasurement(input, { ...BASE_CTX, instrument, correctionFormula: 'linear' })
    expect(linear.correctedSg).not.toBeCloseTo(terrill.correctedSg as number, 4)
    // Баллинг: OE = invert(1.0919540), AE = invert(brixToSg(12))
    const oe = invertBrixToSg(1.0919540)
    const ae = invertBrixToSg(brixToSg(12))
    const re = 0.1808 * oe + 0.8192 * ae
    expect(linear.correctedSg).toBeCloseTo(
      1 + re / (258.6 - (re / 258.2) * 227.1),
      10
    )
  })

  it('ранняя стадия (Bf близко к Bi): авто и ручной Террилл → Novotný + info (не ошибка)', () => {
    const instrument = { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetBx: null, hasCalibrationPair: true }
    // Авто: модель Новотного корректна на ранней стадии — SG_app в физике
    const auto = resolveMeasurement(
      { kind: 'density', rawValue: 18, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      { ...BASE_CTX, instrument, correctionFormula: 'auto' }
    )
    expect(auto.corrections.map((c) => c.type)).toEqual(['novotny-model'])
    expect(auto.correctedSg).toBeLessThanOrEqual(BASE_CTX.startOgSg)
    expect(auto.infos.some((i) => i.includes('близко к стартовому'))).toBe(true)
    expect(auto.warnings).toHaveLength(0)

    // Ручной Террилл: Bf=18 > 0.6×22=13.2 — вне домена → Novotný + info
    const manual = resolveMeasurement(
      { kind: 'density', rawValue: 18, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      { ...BASE_CTX, instrument, correctionFormula: 'terrill' }
    )
    expect(manual.corrections.map((c) => c.type)).toEqual(['novotny-model'])
    expect(manual.infos.some((i) => i.includes('близко к стартовому'))).toBe(true)
    expect(manual.warnings).toHaveLength(0)
  })

  it('авто: Novotný на любой стадии, SG ≤ OG, след содержит модель и ABV', () => {
    const instrument = { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetBx: null, hasCalibrationPair: true }
    for (const raw of [22, 18, 14, 10, 8]) {
      const r = resolveMeasurement(
        { kind: 'density', rawValue: raw, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
        { ...BASE_CTX, instrument, correctionFormula: 'auto' }
      )
      expect(r.corrections.map((c) => c.type)).toEqual(['novotny-model'])
      expect(r.correctedSg).toBeLessThanOrEqual(brixToSg(22.88)) // ≤ истинного OG
      expect(r.correctedSg).toBeGreaterThan(0.99)
      expect(r.correctedBrix).toBeGreaterThan(0)
      expect(r.corrections[0]?.note).toContain('Novotný')
      expect(r.corrections[0]?.note).toContain('% об.')
    }
  })

  it('авто-результаты сходятся с контрольными точками модели', () => {
    const instrument = { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetBx: null, hasCalibrationPair: true }
    // B₀ = 22×1.04 = 22.88; при R=8: SG_app ≈ 0.9989 (по контрольной таблице с WCF-масштабом)
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 8, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      { ...BASE_CTX, instrument, correctionFormula: 'auto' }
    )
    expect(r.correctedSg).toBeGreaterThan(0.99)
    expect(r.correctedSg).toBeLessThan(1.02)
  })

  it('ручной выбор переопределяет авто (линейная вне ранней стадии — Баллинг)', () => {
    const instrument = { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetBx: null, hasCalibrationPair: true }
    // 12 ≤ 0.6×22 = 13.2 — не ранняя стадия, линейная применяется
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 12, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-26T11:00:00.000Z' },
      { ...BASE_CTX, instrument, correctionFormula: 'linear' }
    )
    expect(r.corrections.map((c) => c.type)).toEqual(['fermentation-correction'])
    expect(r.corrections[0]?.note).toContain('Баллинг RE')
  })

  it('замер до/в момент постановки — без ферментной коррекции', () => {
    const r = resolveMeasurement(
      { kind: 'density', rawValue: 22, unit: 'brix', tempC: null, measuredAtUtc: '2026-11-25T10:00:00.000Z' },
      { ...BASE_CTX, instrument: { type: 'refractometer-atc', wcf: 1.04, calibrationOffsetBx: null, hasCalibrationPair: true } }
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
        instrument: { type: 'refractometer-atc', wcf: 1, calibrationOffsetBx: null, hasCalibrationPair: true }
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
