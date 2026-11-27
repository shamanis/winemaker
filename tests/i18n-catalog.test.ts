import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resources } from '../src/shared/i18n/locales'
import {
  additionKindSchema,
  batchStatusSchema,
  instrumentTypeSchema,
  measurementKindSchema,
  operationKindSchema,
  yeastInputSchema
} from '../src/shared/ipc/contracts'
import { GLOSSARY_ORDER, FORMULA_IDS } from '../src/renderer/src/help/glossary'
import { TRACE_CODES } from '../src/shared/calculations/pipeline'

/**
 * Гарантии каталога переводов (design D7, спека localization):
 * паритет языков, заполненность, полнота семейных ключей.
 * Ключи JSON не проверяет компилятор — проверяет этот тест.
 */

const SRC_ROOT = join(import.meta.dirname, '..', 'src')
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

/** Листья каталога: путь через точки → текст. */
function flatten(node: unknown, prefix = ''): Map<string, string> {
  const leaves = new Map<string, string>()
  if (typeof node === 'string') {
    leaves.set(prefix, node)
    return leaves
  }
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    for (const [k, v] of flatten(child, path)) leaves.set(k, v)
  }
  return leaves
}

/** Базовый ключ склоняемой записи: суффикс категории отбрасывается. */
function baseKey(key: string): string {
  return key.replace(PLURAL_SUFFIX, '')
}

function catalog(code: 'ru' | 'en'): Map<string, string> {
  return flatten(resources[code].translation)
}

const RU = catalog('ru')
const EN = catalog('en')

/** Порядок категорий множественного числа языка (Intl — как в i18next). */
function pluralCategories(code: 'ru' | 'en'): Set<string> {
  return new Set(new Intl.PluralRules(code).resolvedOptions().pluralCategories)
}

describe('i18n-каталог: паритет и заполненность языков (design D7)', () => {
  it('наборы базовых ключей всех языков совпадают с русским', () => {
    const ruBase = new Set([...RU.keys()].map(baseKey))
    const enBase = new Set([...EN.keys()].map(baseKey))
    const onlyRu = [...ruBase].filter((k) => !enBase.has(k))
    const onlyEn = [...enBase].filter((k) => !ruBase.has(k))
    expect(
      { onlyRu, onlyEn },
      'базовые ключи ru и en должны совпадать (суффиксы склонений отбрасываются)'
    ).toEqual({ onlyRu: [], onlyEn: [] })
  })

  it('нет пустых строк ни в одном языке', () => {
    for (const [code, leaves] of [
      ['ru', RU],
      ['en', EN]
    ] as const) {
      const empty = [...leaves.entries()].filter(([, v]) => v.trim() === '').map(([k]) => k)
      expect(empty, `пустые строки в ${code}`).toEqual([])
    }
  })

  it('у склоняемых записей есть все категории множественного числа языка', () => {
    for (const [code, leaves] of [
      ['ru', RU],
      ['en', EN]
    ] as const) {
      const needed = pluralCategories(code)
      const byBase = new Map<string, Set<string>>()
      for (const key of leaves.keys()) {
        if (!PLURAL_SUFFIX.test(key)) continue
        const base = baseKey(key)
        if (!byBase.has(base)) byBase.set(base, new Set())
        byBase.get(base)!.add(key.match(PLURAL_SUFFIX)![1]!)
      }
      const missing: string[] = []
      for (const [base, present] of byBase) {
        for (const cat of needed) {
          if (!present.has(cat)) missing.push(`${base}_${cat}`)
        }
      }
      expect(missing, `не хватает форм множественного числа в ${code}`).toEqual([])
    }
  })
})

/** Литеральные ключи t('…') во всех исходниках src. */
function findTLiteralKeys(): Map<string, string> {
  const found = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (!/\.(ts|tsx)$/.test(name)) continue
      const text = readFileSync(path, 'utf-8')
        // Комментарии убираем: t('…') в комментарии требованием не является.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const re = /\bt\(\s*["'`]([^"'`$]+)["'`]/g
      for (const match of text.matchAll(re)) {
        const rel = path.slice(SRC_ROOT.length + 1)
        if (!found.has(match[1]!)) found.set(match[1]!, rel)
      }
    }
  }
  walk(SRC_ROOT)
  return found
}

describe('i18n-каталог: ключи из кода', () => {
  it('каждый литеральный ключ t(…) есть в каждом языке', () => {
    const literals = findTLiteralKeys()
    expect(literals.size, 'в коде должны быть литеральные ключи t').toBeGreaterThan(0)
    const missing: Array<{ key: string; file: string }> = []
    for (const [key, file] of literals) {
      for (const [code, leaves] of [
        ['ru', RU],
        ['en', EN]
      ] as const) {
        if (!leaves.has(baseKey(key))) missing.push({ key, file: `${file} (${code})` })
      }
    }
    expect(missing, 'ключи, отсутствующие в каталоге').toEqual([])
  })
})

/**
 * Динамические семейства: ключи, собираемые из кодов в рантайме
 * (`t(\`batches.status.${s}\`)`), литеральным сканом не ловятся —
 * проверяем по zod-схемам и реестрам (источник истины — схемы).
 */
describe('i18n-каталог: динамические семейства ключей', () => {
  const family = (prefix: string, values: readonly string[]): string[] => {
    const missing: string[] = []
    for (const v of values) {
      for (const [code, leaves] of [
        ['ru', RU],
        ['en', EN]
      ] as const) {
        if (!leaves.has(`${prefix}.${v}`)) missing.push(`${prefix}.${v} (${code})`)
      }
    }
    return missing
  }

  it('статусы партии', () => {
    expect(family('batches.status', batchStatusSchema.options)).toEqual([])
  })

  it('виды технологических операций', () => {
    expect(family('journal.kind', operationKindSchema.options)).toEqual([])
  })

  it('типы приборов', () => {
    expect(family('catalogs.type', instrumentTypeSchema.options)).toEqual([])
  })

  it('виды замеров', () => {
    expect(family('measurements.kind', measurementKindSchema.options)).toEqual([])
  })

  it('виды добавок и единицы дозы', () => {
    expect(family('batches.additionKind', additionKindSchema.options)).toEqual([])
    expect(family('batches.doseUnit', yeastInputSchema.shape.doseUnit.options)).toEqual([])
  })

  it('глоссарий: подпись и определение каждого термина', () => {
    expect(family('help.term', GLOSSARY_ORDER)).toEqual([])
    expect(family('help.termDesc', GLOSSARY_ORDER)).toEqual([])
  })

  it('формулы: запись, заголовок и пояснение каждой', () => {
    for (const key of FORMULA_IDS.flatMap((id) => [
      `help.formulas.${id}.formula`,
      `help.formulas.${id}.title`,
      `help.formulas.${id}.note`
    ])) {
      for (const [code, leaves] of [
        ['ru', RU],
        ['en', EN]
      ] as const) {
        expect(leaves.has(key), `${key} (${code})`).toBe(true)
      }
    }
  })

  it('коды сообщений следа пересчёта (пайплайн)', () => {
    const missing: string[] = []
    for (const code of TRACE_CODES) {
      for (const [lang, leaves] of [
        ['ru', RU],
        ['en', EN]
      ] as const) {
        if (!leaves.has(code)) missing.push(`${code} (${lang})`)
      }
    }
    expect(missing, 'коды следа, отсутствующие в каталоге').toEqual([])
  })
})
