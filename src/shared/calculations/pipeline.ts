import { brixToSg } from './density'
import {
  computePersonalWcf,
  correctHydrometerTemp,
  invertBrixToSg,
  isTempOutOfApproximation,
  linearCorrection,
  terrillCorrection,
  TERRILL_DOMAIN_RATIO
} from './correction'
import { novotny } from './novotny'
import { HYDROMETER_TEMP_K } from './correction'

/**
 * Пайплайн коррекции замера плотности (design D3): сырое показание →
 * прибор → формулы → канонический SG + полный след пересчёта (спека 2.7).
 */

export type MeasurementKind = 'density' | 'temperature' | 'ph'
export type DensityUnit = 'sg' | 'brix'
export type CorrectionFormula = 'auto' | 'terrill' | 'linear'

export interface PipelineInstrument {
  readonly type: string
  readonly wcf: number | null
  /** Смещение показаний ареометра, °Bx. */
  readonly calibrationOffsetBx: number | null
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
  /**
   * Сырое стартовое показание партии (без WCF) — вход формулы Террилла,
   * которая регрессирована на сырых показаниях (design: correction inputs).
   */
  readonly startRawGravity?: { value: number; unit: DensityUnit } | null
  /** OG в SG (с WCF) — для линейной Баллинга (OE — истинный экстракт). */
  readonly startOgSg?: number | null
  /** Истинный экстракт старта в °Bx (с WCF) — B₀ модели Новотного. */
  readonly startCorrectedBrix?: number | null
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
  /** Ошибки/предупреждения — красным в UI. */
  readonly warnings: string[]
  /** Информационные сообщения — нейтральным стилем (не ошибка). */
  readonly infos: string[]
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
    return { correctedSg: null, correctedBrix: null, corrections: [], warnings: [], infos: [] }
  }

  const corrections: CorrectionStep[] = []
  const warnings: string[] = []
  const instrument = ctx.instrument
  if (!instrument) {
    throw new TypeError('Density measurement requires an instrument')
  }

  /* Ареометр: шкала Brix — смещение и темп-коррекция в Bx, затем Bx → SG */
  if (isHydrometer(instrument.type)) {
    let b = input.unit === 'sg' ? invertBrixToSg(input.rawValue) : input.rawValue
    if (input.unit === 'sg') {
      corrections.push({
        type: 'sg-to-brix',
        input: input.rawValue,
        output: b,
        note: 'Показание в SG приведено к шкале Brix (прибор пользователя — Brix)'
      })
    }

    if (instrument.calibrationOffsetBx != null && instrument.calibrationOffsetBx !== 0) {
      const off = instrument.calibrationOffsetBx
      corrections.push({
        type: 'calibration-offset',
        input: b,
        output: b + off,
        note: `Калибровочное смещение прибора ${off > 0 ? '+' : ''}${off} °Bx`
      })
      b += off
    }

    const sg0 = brixToSg(b)
    let sg = sg0
    if (input.tempC != null) {
      const calibrationTempC = instrument.calibrationTempC ?? 20
      sg = sg0 * (1 + HYDROMETER_TEMP_K * (input.tempC - calibrationTempC))
      corrections.push({
        type: 'hydrometer-temp',
        input: sg0,
        output: sg,
        note: `Температурная коррекция к T_кал ${calibrationTempC} °C (сусло ${input.tempC} °C)`
      })
      if (isTempOutOfApproximation(input.tempC)) {
        warnings.push(
          `Температура сусла ${input.tempC} °C вне зоны аппроксимации (10–35 °C) — поправка приблизительная, см. таблицу паспорта прибора`
        )
      }
    }

    return { correctedSg: sg, correctedBrix: b, corrections, warnings, infos: [] }
  }

  /* Рефрактометр: до брожения WCF → SG; на брожении Террилл/Баллинг на сырых показаниях */
  if (isRefractometer(instrument.type)) {
    const fermenting =
      ctx.startOgSg != null && input.measuredAtUtc > ctx.batchStartDateUtc

    if (fermenting) {
      // Предупреждение об усреднённой коррекции действует и здесь (спека 6.3.5):
      // без пары применён усреднённый WCF для OG, а регрессия Террилла —
      // по среднему суслу.
      if (!instrument.hasCalibrationPair) {
        warnings.push(
          'У рефрактометра нет калибровочной пары — коррекция ведётся по усреднённой формуле (спека 6.3.5)'
        )
      }
      // Формула Террилла регрессирована на СЫРЫХ показаниях (без WCF):
      // алкогольное искажение уже учтено в регрессии (design: correction inputs).
      const biRaw =
        ctx.startRawGravity?.unit === 'brix'
          ? ctx.startRawGravity.value
          : ctx.startOgSg != null
            ? invertBrixToSg(ctx.startOgSg) // старт в SG: сахарный эквивалент OG
            : null
      const bfRaw =
        input.unit === 'brix'
          ? input.rawValue
          : invertBrixToSg(input.rawValue)
      if (biRaw == null) {
        return { correctedSg: null, correctedBrix: null, corrections, warnings, infos: [] }
      }

      const formula = ctx.correctionFormula
      let sg: number
      if (formula === 'auto') {
        // Основная модель хода брожения — двухкомпонентная Novotný
        // (docs/refractometer.md): корректна на всём протяжении,
        // даёт истинный экстракт B, крепость A и кажущуюся SG.
        // R — показание с WCF; B₀ — истинный экстракт старта.
        const r = bfRaw * (instrument.wcf ?? 1)
        const b0 =
          ctx.startCorrectedBrix ?? invertBrixToSg(ctx.startOgSg as number)
        const n = novotny(r, b0)
        if (!instrument.hasCalibrationPair) {
          warnings.push(
            'У рефрактометра нет калибровочной пары — коррекция ведётся по усреднённому коэффициенту (спека 6.3.5)'
          )
        }
        const infos: string[] = []
        if (biRaw != null && bfRaw > 0.6 * biRaw) {
          infos.push(
            'Показание близко к стартовому — спиртовая коррекция ещё не требуется, применена двухкомпонентная модель Новотного'
          )
        }
        corrections.push({
          type: 'novotny-model',
          input: bfRaw,
          output: n.apparentSg,
          note: `Двухкомпонентная модель (Novotný): R=${r.toFixed(2)} °Bx (с WCF), B₀=${b0.toFixed(2)} °Bx → истинный экстракт B=${n.trueExtractBx.toFixed(2)} °Bx, крепость ${n.abvPct.toFixed(1)} % об., итераций ${n.iterations}`
        })
        return {
          correctedSg: n.apparentSg,
          correctedBrix: n.trueExtractBx,
          corrections,
          warnings,
          infos
        }
      }
      // Ранняя стадия (docs: R > 0.6·Bi): эмпирические формулы вне зоны
      // применимости — работает двухкомпонентная модель Новотного.
      // Это информация для пользователя, не ошибка.
      const infos: string[] = []
      const earlyStage = biRaw != null && bfRaw > 0.6 * biRaw
      if (earlyStage) {
        infos.push(
          'Показание близко к стартовому — для коррекции использована двухкомпонентная модель Новотного'
        )
        const r = bfRaw * (instrument.wcf ?? 1)
        const b0 =
          ctx.startCorrectedBrix ?? invertBrixToSg(ctx.startOgSg as number)
        const n = novotny(r, b0)
        corrections.push({
          type: 'novotny-model',
          input: bfRaw,
          output: n.apparentSg,
          note: `Двухкомпонентная модель (Novotný): R=${r.toFixed(2)} °Bx (с WCF), B₀=${b0.toFixed(2)} °Bx → истинный экстракт B=${n.trueExtractBx.toFixed(2)} °Bx, крепость ${n.abvPct.toFixed(1)} % об.`
        })
        return {
          correctedSg: n.apparentSg,
          correctedBrix: n.trueExtractBx,
          corrections,
          warnings,
          infos
        }
      }

      // Ручной выбор формулы (переопределяет авто, design D4):
      if (formula === 'linear') {
        // Баллинг: OE — истинный экстракт старта (из OG с WCF),
        // AE — кажущийся экстракт из сырого текущего показания.
        const oe = invertBrixToSg(ctx.startOgSg as number)
        const ae = invertBrixToSg(brixToSg(bfRaw))
        sg = linearCorrection(oe, ae)
        corrections.push({
          type: 'fermentation-correction',
          input: bfRaw,
          output: sg,
          note: `Линейная (Баллинг RE): OE=${oe.toFixed(2)} °P, AE=${ae.toFixed(2)} °P (Bi=${biRaw.toFixed(2)}, Bf=${bfRaw.toFixed(2)} °Bx сырые)`
        })
      } else {
        sg = terrillCorrection(biRaw, bfRaw)
        corrections.push({
          type: 'fermentation-correction',
          input: bfRaw,
          output: sg,
          note: `Формула Террилла: Bi=${biRaw.toFixed(2)}, Bf=${bfRaw.toFixed(2)} °Bx (сырые показания, без WCF)`
        })
      }

      // Страховка физической границы: результат не может превысить OG.
      const ogSg = ctx.startOgSg as number
      if (sg > ogSg) {
        const r = bfRaw * (instrument.wcf ?? 1)
        const b0 =
          ctx.startCorrectedBrix ?? invertBrixToSg(ctx.startOgSg as number)
        const n = novotny(r, b0)
        infos.push(
          'Показание близко к стартовому — применена двухкомпонентная модель Новотного'
        )
        corrections.push({
          type: 'novotny-model',
          input: bfRaw,
          output: n.apparentSg,
          note: 'Результат эмпирической формулы нефизичен — применена двухкомпонентная модель Новотного'
        })
        sg = n.apparentSg
      }
      return { correctedSg: sg, correctedBrix: null, corrections, warnings, infos }
    }

    // До брожения: WCF meaningful (сахарный эквивалент сусла).
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

    const sg = brixToSg(correctedBrix)
    corrections.push({
      type: 'brix-to-sg',
      input: correctedBrix,
      output: sg,
      note: 'До начала брожения — перевод Brix → SG'
    })
    return { correctedSg: sg, correctedBrix, corrections, warnings, infos: [] }
  }

  /* Иной прибор: считаем показание уже в SG */
  if (input.unit === 'brix') {
    const sg = brixToSg(input.rawValue)
    corrections.push({ type: 'brix-to-sg', input: input.rawValue, output: sg })
    return { correctedSg: sg, correctedBrix: null, corrections, warnings, infos: [] }
  }
  return { correctedSg: input.rawValue, correctedBrix: null, corrections, warnings, infos: [] }
}

export { computePersonalWcf }
