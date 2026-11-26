import { describe, expect, it } from 'vitest'
import {
  batchCreateSchema,
  channels,
  gravityRawSchema,
  instrumentInputSchema,
  settingsSchema,
  strainInputSchema
} from '../src/shared/ipc/contracts'

describe('zod-схемы доменов (add-catalogs-and-batches)', () => {
  it('прибор: валидный ввод принимается, пустое имя и неизвестный тип — нет', () => {
    const ok = instrumentInputSchema.safeParse({
      name: 'Рефрактометр РПЛ-3',
      type: 'refractometer-atc',
      wcf: 1.04,
      calibrationOffsetSg: null
    })
    expect(ok.success).toBe(true)

    expect(instrumentInputSchema.safeParse({ name: '', type: 'hydrometer' }).success).toBe(false)
    expect(instrumentInputSchema.safeParse({ name: 'X', type: 'microscope' }).success).toBe(false)
  })

  it('штамм: nullable-поля опциональны', () => {
    const ok = strainInputSchema.safeParse({ name: 'EC-1118', producer: 'Lallemand' })
    expect(ok.success).toBe(true)
    expect(strainInputSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('плотность старта: физические диапазоны (Brix 0–80, SG 0.9–1.2)', () => {
    expect(gravityRawSchema.safeParse({ value: 22, unit: 'brix' }).success).toBe(true)
    expect(gravityRawSchema.safeParse({ value: 120, unit: 'brix' }).success).toBe(false)
    expect(gravityRawSchema.safeParse({ value: 1.09, unit: 'sg' }).success).toBe(true)
    expect(gravityRawSchema.safeParse({ value: 0.5, unit: 'sg' }).success).toBe(false)
  })

  it('создание партии: без дрожжей/добавок допустимо, без сырья — нет', () => {
    const ok = batchCreateSchema.safeParse({
      title: 'Изабелла',
      rawMaterial: 'Виноград',
      startDateUtc: '2026-11-25T10:00:00.000Z',
      startParams: { gravity: { raw: { value: 22, unit: 'brix' } } },
      yeast: [],
      additions: []
    })
    expect(ok.success).toBe(true)

    const bad = batchCreateSchema.safeParse({
      title: '',
      rawMaterial: 'Виноград',
      startDateUtc: '2026-11-25T10:00:00.000Z',
      startParams: { gravity: { raw: { value: 22, unit: 'brix' } } },
      yeast: [],
      additions: []
    })
    expect(bad.success).toBe(false)
  })

  it('смена статуса: только валидные значения enum', () => {
    const channel = channels.batchesUpdateStatus
    expect(channel.request.safeParse({ id: 'x', to: 'aging' }).success).toBe(true)
    expect(channel.request.safeParse({ id: 'x', to: 'drinking' }).success).toBe(false)
  })

  it('настройки: авто/Террилл/линейная — валидные значения', () => {
    expect(settingsSchema.safeParse({ densityUnit: 'sg', correctionFormula: 'terrill' }).success).toBe(true)
    expect(settingsSchema.safeParse({ densityUnit: 'sg', correctionFormula: 'auto' }).success).toBe(true)
    expect(settingsSchema.safeParse({ densityUnit: 'plato', correctionFormula: 'terrill' }).success).toBe(false)
    expect(settingsSchema.safeParse({ densityUnit: 'brix', correctionFormula: 'magic' }).success).toBe(false)
  })
})
