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
 * Пайплайн независим от языка (design D6): след несёт машинные коды
 * сообщений и параметры; текст подставляет каталог переводов — при
 * предпросмотре в renderer и при сохранении в main.
 */

export type MeasurementKind = 'density' | 'temperature' | 'ph'
export type DensityUnit = 'sg' | 'brix'
export type CorrectionFormula = 'auto' | 'terrill' | 'linear'

/** Параметры сообщения следа: числа и готовые строки (например, со знаком). */
export type TraceParams = Readonly<Record<string, string | number>>

/** Сообщение следа: код в каталоге (trace.*) + параметры. */
export interface TraceMessage {
  readonly code: string
  readonly params?: TraceParams
}

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
  /** Код сообщения следа в каталоге (trace.*); шаг без сообщения — без кода. */
  readonly code?: string
  readonly params?: TraceParams
}

export interface ResolvedMeasurement {
  /** Каноническое значение для всех расчётов (спека 2.10). */
  readonly correctedSg: number | null
  readonly correctedBrix: number | null
  readonly corrections: CorrectionStep[]
  /** Предупреждения — красным в UI. */
  readonly warnings: TraceMessage[]
  /** Информационные сообщения — нейтральным стилем (не ошибка). */
  readonly infos: TraceMessage[]
}

/** Все коды сообщений следа, которые может выдать пайплайн (проверка каталога). */
export const TRACE_CODES = [
  'trace.sgToBrix',
  'trace.calibrationOffset',
  'trace.hydrometerTemp',
  'trace.tempOutOfApprox',
  'trace.wcfFromPair',
  'trace.wcfManual',
  'trace.wcfNone',
  'trace.noPersonalWcf',
  'trace.brixToSg',
  'trace.earlyStageAuto',
  'trace.earlyStageFallback',
  'trace.nonPhysicalFallback',
  'trace.novotnyModel',
  'trace.novotnyModelShort',
  'trace.linearCorrection',
  'trace.terrillCorrection',
  'trace.nonPhysicalResult'
] as const

const isHydrometer = (type: string): boolean => type === 'hydrometer'
const isRefractometer = (type: string): boolean =>
  type === 'refractometer-atc' || type === 'refractometer'

/** Предупреждение: ни калибровочной пары, ни ручного WCF — показания без поправки. */
const NO_PERSONAL_WCF: TraceMessage = { code: 'trace.noPersonalWcf' }

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
  const warnings: TraceMessage[] = []
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
        code: 'trace.sgToBrix'
      })
    }

    if (instrument.calibrationOffsetBx != null && instrument.calibrationOffsetBx !== 0) {
      const off = instrument.calibrationOffsetBx
      corrections.push({
        type: 'calibration-offset',
        input: b,
        output: b + off,
        code: 'trace.calibrationOffset',
        params: { offset: off > 0 ? `+${off}` : `${off}` }
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
        code: 'trace.hydrometerTemp',
        params: { tCal: calibrationTempC, tMust: input.tempC }
      })
      if (isTempOutOfApproximation(input.tempC)) {
        warnings.push({ code: 'trace.tempOutOfApprox', params: { tMust: input.tempC } })
      }
    }

    return { correctedSg: sg, correctedBrix: b, corrections, warnings, infos: [] }
  }

  /* Рефрактометр: до брожения WCF → SG; на брожении Террилл/Баллинг на сырых показаниях */
  if (isRefractometer(instrument.type)) {
    const fermenting =
      ctx.startOgSg != null && input.measuredAtUtc > ctx.batchStartDateUtc

    if (fermenting) {
      // Без персонального коэффициента (ни пары, ни ручного WCF) показание
      // идёт в расчёт без поправки — предупреждаем.
      if (instrument.wcf == null) {
        warnings.push(NO_PERSONAL_WCF)
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
        if (instrument.wcf == null) {
          warnings.push(NO_PERSONAL_WCF)
        }
        const infos: TraceMessage[] = []
        if (biRaw != null && bfRaw > 0.6 * biRaw) {
          infos.push({ code: 'trace.earlyStageAuto' })
        }
        corrections.push({
          type: 'novotny-model',
          input: bfRaw,
          output: n.apparentSg,
          code: 'trace.novotnyModel',
          params: { r, b0, b: n.trueExtractBx, abv: n.abvPct, iterations: n.iterations }
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
      const infos: TraceMessage[] = []
      const earlyStage = biRaw != null && bfRaw > 0.6 * biRaw
      if (earlyStage) {
        infos.push({ code: 'trace.earlyStageFallback' })
        const r = bfRaw * (instrument.wcf ?? 1)
        const b0 =
          ctx.startCorrectedBrix ?? invertBrixToSg(ctx.startOgSg as number)
        const n = novotny(r, b0)
        corrections.push({
          type: 'novotny-model',
          input: bfRaw,
          output: n.apparentSg,
          code: 'trace.novotnyModelShort',
          params: { r, b0, b: n.trueExtractBx, abv: n.abvPct }
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
          code: 'trace.linearCorrection',
          params: { oe, ae, bi: biRaw, bf: bfRaw }
        })
      } else {
        sg = terrillCorrection(biRaw, bfRaw)
        corrections.push({
          type: 'fermentation-correction',
          input: bfRaw,
          output: sg,
          code: 'trace.terrillCorrection',
          params: { bi: biRaw, bf: bfRaw }
        })
      }

      // Страховка физической границы: результат не может превысить OG.
      const ogSg = ctx.startOgSg as number
      if (sg > ogSg) {
        const r = bfRaw * (instrument.wcf ?? 1)
        const b0 =
          ctx.startCorrectedBrix ?? invertBrixToSg(ctx.startOgSg as number)
        const n = novotny(r, b0)
        infos.push({ code: 'trace.nonPhysicalFallback' })
        corrections.push({
          type: 'novotny-model',
          input: bfRaw,
          output: n.apparentSg,
          code: 'trace.nonPhysicalResult'
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
      code: instrument.hasCalibrationPair
        ? 'trace.wcfFromPair'
        : instrument.wcf != null
          ? 'trace.wcfManual'
          : 'trace.wcfNone',
      params: { wcf }
    })
    if (instrument.wcf == null) {
      warnings.push(NO_PERSONAL_WCF)
    }

    const sg = brixToSg(correctedBrix)
    corrections.push({
      type: 'brix-to-sg',
      input: correctedBrix,
      output: sg,
      code: 'trace.brixToSg'
    })
    return { correctedSg: sg, correctedBrix, corrections, warnings, infos: [] }
  }

  /* Иной прибор: считаем показание уже в SG */
  if (input.unit === 'brix') {
    const sg = brixToSg(input.rawValue)
    corrections.push({ type: 'brix-to-sg', input: input.rawValue, output: sg })
    return { correctedSg: sg, correctedBrix: null, corrections, warnings: [], infos: [] }
  }
  return { correctedSg: input.rawValue, correctedBrix: null, corrections, warnings: [], infos: [] }
}

export { computePersonalWcf }
