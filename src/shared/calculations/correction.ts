import { brixToSg } from './density'

/**
 * Формулы приборной коррекции (vision «Специфика предметной области»,
 * раздел «Корректировка показаний ареометра АС-3»).
 * Все функции чистые — тестируются без Electron.
 */

/* ── Температурная коррекция ареометра ── */

/** Рабочая зона аппроксимации линейной формулы (vision): 15–30 °C. */
export const TEMP_OK_MIN_C = 15
export const TEMP_OK_MAX_C = 30
/** Границы предупреждения (vision): <10 или >35 °C — вне аппроксимации. */
export const TEMP_WARN_MIN_C = 10
export const TEMP_WARN_MAX_C = 35
/** Домен Террилла (docs/refractometer.md): R должен опуститься до 0.6 от OG. */
export const TERRILL_DOMAIN_RATIO = 0.6

/** Коэффициент линейной темп-коррекции (vision, k = 3.7e-4) — на SG. */
export const HYDROMETER_TEMP_K = 3.7e-4
const TEMP_K = HYDROMETER_TEMP_K

/**
 * Корректировка показаний ареометра по температуре сусла
 * (формула из vision): SG_corr = S × (1 + k × (T − T_кал)).
 * `calibrationTempC` — T_кал конкретного прибора (по умолчанию 20 °C).
 */
export function correctHydrometerTemp(
  rawSg: number,
  tempC: number,
  calibrationTempC: number = 20
): number {
  return rawSg * (1 + TEMP_K * (tempC - calibrationTempC))
}

/** Поправка выходит за аппроксимацию — нужен предупреждение (vision). */
export function isTempOutOfApproximation(tempC: number): boolean {
  return tempC < TEMP_WARN_MIN_C || tempC > TEMP_WARN_MAX_C
}

/* ── Инверсия SG → Brix ── */

/** Обратный перевод SG → °Bx (живёт в density.ts рядом с `brixToSg`). */
export { invertBrixToSg } from './density'

/* ── Коррекция рефрактометра после начала брожения ── */

/**
 * Точная коррекция — кубическая формула Шона Террилла (vision, дословно):
 * FG = 1 − 0.0044993·Bi + 0.011774·Bf + 0.00027581·Bi² − 0.0012717·Bf²
 *      − 0.00000728·Bi³ + 0.000063293·Bf³
 */
export function terrillCorrection(biBrix: number, bfBrix: number): number {
  return (
    1 -
    0.0044993 * biBrix +
    0.011774 * bfBrix +
    0.00027581 * biBrix ** 2 -
    0.0012717 * bfBrix ** 2 -
    0.00000728 * biBrix ** 3 +
    0.000063293 * bfBrix ** 3
  )
}

/**
 * Упрощённая линейная коррекция — соотношение Баллинга:
 * RE = 0.1808·OE + 0.8192·AE (°Plato), затем Plato → SG сахарной формулой.
 * OE — истинный экстракт старта, AE — кажущийся экстракт текущего сусла.
 */
export function linearCorrection(oePlato: number, aePlato: number): number {
  const re = 0.1808 * oePlato + 0.8192 * aePlato
  return brixToSg(re)
}

/* ── Калибровочная пара «рефрактометр — ареометр» ── */

/**
 * Персональный WCF из калибровочной пары: оба показания в °Bx
 * (ареометры пользователя имеют шкалу Brix), WCF = гидроBx / рефрBx.
 */
export function computePersonalWcf(refrBrix: number, hydrometerBx: number): number {
  return hydrometerBx / refrBrix
}
