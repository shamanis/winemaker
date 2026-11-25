import { brixToSg } from './density'
import {
  computePersonalWcf,
  correctHydrometerTemp,
  invertBrixToSg,
  isTempOutOfApproximation,
  linearCorrection,
  terrillCorrection
} from './correction'

/**
 * Пайплайн коррекции замера плотности (design D3): сырое показание →
 * прибор → формулы → канонический SG + полный след пересчёта (спека 2.7).
 */

export type MeasurementKind = 'density' | 'temperature' | 'ph'
export type DensityUnit = 'sg' | 'brix'
export type CorrectionFormula = 'terrill' | 'linear'

export interface PipelineInstrument {
  readonly type: string
  readonly wcf: number | null
  readonly calibrationOffsetSg: number | null
  readonly calibrationTempC?: number | null
  /** Есть персональная калибровочная пара (refractometer). */
  readonly hasCalibrationPair?: boolean
}

export interface MeasurementRawInput {
  readonly kind: MeasurementKind
  readonly rawValue: number
  readonly unit: DensityUnit
  readonly tempC?: number | null
  readonly measuredAtUtc: string
}

export interface PipelineContext {
  /** Для density обязателен (TypeError при null); для temp/ph не нужен. */
  readonly instrument: PipelineInstrument | null
  readonly correctionFormula: CorrectionFormula
  /** Corrected Brix старта партии (Bi) — из startParams. */
  readonly startCorrectedBrix?: number | null
  /** OG в SG — если Bi нет (старт в SG), Bi вычисляется инверсией. */
  readonly startOgSg?: number | null
  readonly batchStartDateUtc: string
}

export interface CorrectionStep {
  readonly type: string
  readonly input: number
  readonly output: number
  readonly note?: string
}

export interface ResolvedMeasurement {
  /** Каноническое значение для всех расчётов (спека 2.10). */
  readonly correctedSg: number | null
  readonly correctedBrix: number | null
  readonly corrections: CorrectionStep[]
  readonly warnings: string[]
}

const isHydrometer = (type: string): boolean => type === 'hydrometer'
const isRefractometer = (type: string): boolean =>
  type === 'refractometer-atc' || type === 'refractometer'

/**
 * Вычисляет скорректированный SG замера. Для temperature/ph значение
 * сохраняется как есть. Бросает TypeError, если у замера плотности нет прибора
 * (zod-схема IPC валидирует это же на границе).
 */
export function resolveMeasurement(
  input: MeasurementRawInput,
  ctx: PipelineContext
): ResolvedMeasurement {
  if (input.kind !== 'density') {
    return { correctedSg: null, correctedBrix: null, corrections: [], warnings: [] }
  }

  const corrections: CorrectionStep[] = []
  const warnings: string[] = []
  const instrument = ctx.instrument
  if (!instrument) {
    throw new TypeError('Density measurement requires an instrument')
  }

  /* Ареометр: [Brix→SG] → температура → калибровочное смещение */
  if (isHydrometer(instrument.type)) {
    let sg = input.rawValue
    if (input.unit === 'brix') {
      const converted = brixToSg(input.rawValue)
      corrections.push({
        type: 'brix-to-sg',
        input: input.rawValue,
        output: converted,
        note: 'Перевод Brix → SG (показание ареометра в шкале Brix)'
      })
      sg = converted
    }

    if (input.tempC != null) {
      const calibrationTempC = instrument.calibrationTempC ?? 20
      const corrected = correctHydrometerTemp(sg, input.tempC, calibrationTempC)
      corrections.push({
        type: 'hydrometer-temp',
        input: sg,
        output: corrected,
        note: `Температурная коррекция к T_кал ${calibrationTempC} °C (сусло ${input.tempC} °C)`
      })
      sg = corrected
      if (isTempOutOfApproximation(input.tempC)) {
        warnings.push(
          `Температура сусла ${input.tempC} °C вне зоны аппроксимации (10–35 °C) — поправка приблизительная, см. таблицу паспорта прибора`
        )
      }
    }

    if (instrument.calibrationOffsetSg != null && instrument.calibrationOffsetSg !== 0) {
      const corrected = sg + instrument.calibrationOffsetSg
      corrections.push({
        type: 'calibration-offset',
        input: sg,
        output: corrected,
        note: `Калибровочное смещение прибора ${instrument.calibrationOffsetSg > 0 ? '+' : ''}${instrument.calibrationOffsetSg} SG`
      })
      sg = corrected
    }

    return { correctedSg: sg, correctedBrix: null, corrections, warnings }
  }

  /* Рефрактометр: WCF → [Террилл | линейная] для бродящего сусла */
  if (isRefractometer(instrument.type)) {
    const wcf = instrument.wcf ?? 1
    const correctedBrix = input.rawValue * wcf
    corrections.push({
      type: 'wcf',
      input: input.rawValue,
      output: correctedBrix,
      note: instrument.hasCalibrationPair
        ? `Персональный WCF прибора ${wcf}`
        : `Усреднённый WCF ${wcf} — калибровочная пара не задана`
    })
    if (!instrument.hasCalibrationPair) {
      warnings.push(
        'У рефрактометра нет калибровочной пары — коррекция ведётся по усреднённому коэффициенту (спека 6.3.5)'
      )
    }

    const bi =
      ctx.startCorrectedBrix != null
        ? ctx.startCorrectedBrix
        : ctx.startOgSg != null
          ? invertBrixToSg(ctx.startOgSg)
          : null

    const isAfterStart = input.measuredAtUtc > ctx.batchStartDateUtc
    const fermenting = bi != null && isAfterStart

    if (fermenting) {
      const formula = ctx.correctionFormula
      const sg =
        formula === 'linear'
          ? linearCorrection(bi as number, correctedBrix)
          : terrillCorrection(bi as number, correctedBrix)
      corrections.push({
        type: 'fermentation-correction',
        input: correctedBrix,
        output: sg,
        note: `${formula === 'linear' ? 'Линейная (Баллинг RE)' : 'Формула Террилла'}: Bi=${(bi as number).toFixed(2)} °Bx, Bf=${correctedBrix.toFixed(2)} °Bx`
      })
      return { correctedSg: sg, correctedBrix, corrections, warnings }
    }

    const sg = brixToSg(correctedBrix)
    corrections.push({
      type: 'brix-to-sg',
      input: correctedBrix,
      output: sg,
      note: 'До начала брожения — перевод Brix → SG'
    })
    return { correctedSg: sg, correctedBrix, corrections, warnings }
  }

  /* Иной прибор: считаем показание уже в SG */
  if (input.unit === 'brix') {
    const sg = brixToSg(input.rawValue)
    corrections.push({ type: 'brix-to-sg', input: input.rawValue, output: sg })
    return { correctedSg: sg, correctedBrix: null, corrections, warnings }
  }
  return { correctedSg: input.rawValue, correctedBrix: null, corrections, warnings }
}

export { computePersonalWcf }
