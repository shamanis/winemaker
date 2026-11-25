import { z } from 'zod'

/**
 * Дескрипторы IPC-каналов: имя + zod-схемы запроса и ответа.
 * Единый источник типов для main, preload и renderer (см. design.md D3).
 */

export interface ChannelDefinition {
  readonly name: string
  readonly request: z.ZodType
  readonly response: z.ZodType
}

export function defineChannel<C extends ChannelDefinition>(channel: C): C {
  return channel
}

/* ── Доменные схемы (design add-catalogs-and-batches D1, D4) ── */

export const instrumentTypeSchema = z.enum([
  'refractometer-atc',
  'refractometer',
  'hydrometer',
  'other'
])
export type InstrumentType = z.infer<typeof instrumentTypeSchema>

export const instrumentInputSchema = z.object({
  name: z.string().min(1),
  type: instrumentTypeSchema,
  wcf: z.number().positive().nullable().optional(),
  calibrationOffsetSg: z.number().nullable().optional()
})
export type InstrumentInput = z.infer<typeof instrumentInputSchema>

export const instrumentDtoSchema = instrumentInputSchema.extend({
  id: z.string(),
  createdAtUtc: z.string(),
  updatedAtUtc: z.string()
})
export type InstrumentDto = z.infer<typeof instrumentDtoSchema>

export const strainInputSchema = z.object({
  name: z.string().min(1),
  producer: z.string().nullable().optional(),
  tempMinC: z.number().nullable().optional(),
  tempMaxC: z.number().nullable().optional(),
  alcoholTolerancePct: z.number().nullable().optional(),
  notes: z.string().nullable().optional()
})
export type StrainInput = z.infer<typeof strainInputSchema>

export const strainDtoSchema = strainInputSchema.extend({
  id: z.string(),
  createdAtUtc: z.string(),
  updatedAtUtc: z.string()
})
export type StrainDto = z.infer<typeof strainDtoSchema>

export const gravityRawSchema = z
  .object({
    value: z.number(),
    unit: z.enum(['sg', 'brix']),
    instrumentId: z.string().nullable().optional()
  })
  .refine(
    (g) =>
      g.unit === 'brix'
        ? g.value >= 0 && g.value <= 80
        : g.value >= 0.9 && g.value <= 1.2,
    { message: 'Показание вне физического диапазона (Brix 0–80, SG 0.9–1.2)' }
  )
export type GravityRaw = z.infer<typeof gravityRawSchema>

/** Сырой ввод старта; ogSg вычисляется в BatchRepository (design D7). */
export const startParamsInputSchema = z.object({
  gravity: z.object({ raw: gravityRawSchema }),
  ph: z.number().nullable().optional(),
  tempC: z.number().nullable().optional()
})
export type StartParamsInput = z.infer<typeof startParamsInputSchema>

export const startParamsDtoSchema = z.object({
  gravity: z.object({
    raw: gravityRawSchema,
    ogSg: z.number(),
    correctedBrix: z.number().nullable().optional()
  }),
  ph: z.number().nullable().optional(),
  tempC: z.number().nullable().optional()
})
export type StartParamsDto = z.infer<typeof startParamsDtoSchema>

export const yeastInputSchema = z.object({
  strainId: z.string().nullable().optional(),
  strainName: z.string().min(1),
  producer: z.string().nullable().optional(),
  doseAmount: z.number().positive(),
  doseUnit: z.enum(['g', 'ml', 'packet']),
  addedAtUtc: z.string(),
  productionDateUtc: z.string().nullable().optional()
})
export type YeastInput = z.infer<typeof yeastInputSchema>

export const yeastDtoSchema = yeastInputSchema.extend({ id: z.string(), batchId: z.string() })
export type YeastDto = z.infer<typeof yeastDtoSchema>

export const additionKindSchema = z.enum(['nutrient', 'enzyme', 'so2', 'sugar', 'acid', 'other'])
export type AdditionKind = z.infer<typeof additionKindSchema>

export const additionInputSchema = z.object({
  name: z.string().min(1),
  kind: additionKindSchema,
  doseAmount: z.number().positive(),
  doseUnit: z.string().min(1),
  addedAtUtc: z.string(),
  notes: z.string().nullable().optional()
})
export type AdditionInput = z.infer<typeof additionInputSchema>

export const additionDtoSchema = additionInputSchema.extend({ id: z.string(), batchId: z.string() })
export type AdditionDto = z.infer<typeof additionDtoSchema>

export const batchStatusSchema = z.enum([
  'fermenting',
  'slow-fermenting',
  'aging',
  'bottling',
  'archived'
])
export type BatchStatus = z.infer<typeof batchStatusSchema>

export const finalResultSchema = z.object({
  finalGravity: z.number().nullable().optional(),
  abvPct: z.number().nullable().optional(),
  tastingNotes: z.string().nullable().optional()
})
export type FinalResultDto = z.infer<typeof finalResultSchema>

export const batchDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  rawMaterial: z.string(),
  style: z.string().nullable(),
  volumeLiters: z.number().nullable(),
  startDateUtc: z.string(),
  status: batchStatusSchema,
  startParams: startParamsDtoSchema,
  finalResult: finalResultSchema.nullable(),
  createdAtUtc: z.string(),
  archivedAtUtc: z.string().nullable()
})
export type BatchDto = z.infer<typeof batchDtoSchema>

export const batchFullDtoSchema = z.object({
  batch: batchDtoSchema,
  yeast: z.array(yeastDtoSchema),
  additions: z.array(additionDtoSchema),
  history: z.array(
    z.object({
      id: z.string(),
      batchId: z.string(),
      fromStatus: batchStatusSchema.nullable(),
      toStatus: batchStatusSchema,
      atUtc: z.string()
    })
  )
})
export type BatchFullDto = z.infer<typeof batchFullDtoSchema>

export const batchCreateSchema = z.object({
  title: z.string().min(1),
  rawMaterial: z.string().min(1),
  style: z.string().nullable().optional(),
  volumeLiters: z.number().positive().nullable().optional(),
  startDateUtc: z.string(),
  startParams: startParamsInputSchema,
  yeast: z.array(yeastInputSchema),
  additions: z.array(additionInputSchema)
})
export type BatchCreateInput = z.infer<typeof batchCreateSchema>

export const settingsSchema = z.object({
  densityUnit: z.enum(['sg', 'brix']),
  correctionFormula: z.enum(['terrill', 'linear'])
})
export type AppSettings = z.infer<typeof settingsSchema>

/* ── Фабрика CRUD-дескрипторов (design D4: без копипасты) ── */

interface CrudChannels {
  list: ChannelDefinition
  create: ChannelDefinition
  update: ChannelDefinition
  delete: ChannelDefinition
}

function crudChannels<In extends z.ZodObject<any>, Dto extends z.ZodType>(
  prefix: string,
  input: In,
  dto: Dto
): CrudChannels {
  return {
    list: defineChannel({
      name: `${prefix}:list`,
      request: z.object({}),
      response: z.object({ items: z.array(dto) })
    }),
    create: defineChannel({
      name: `${prefix}:create`,
      request: input,
      response: z.object({ item: dto })
    }),
    update: defineChannel({
      name: `${prefix}:update`,
      request: z.object({ id: z.string(), patch: input.partial() }),
      response: z.object({ item: dto.nullable() })
    }),
    delete: defineChannel({
      name: `${prefix}:delete`,
      request: z.object({ id: z.string() }),
      response: z.object({ ok: z.boolean() })
    })
  }
}

const instrumentsCrud = crudChannels('instruments', instrumentInputSchema, instrumentDtoSchema)
const strainsCrud = crudChannels('yeast-strains', strainInputSchema, strainDtoSchema)

/* ── Служебные каналы каркаса ── */

export const appHealthChannel = defineChannel({
  name: 'app:health',
  request: z.object({}),
  response: z.object({
    pong: z.literal(true),
    appVersion: z.string(),
    utilityEcho: z.string(),
    time: z.string()
  })
})

export const appStateGetChannel = defineChannel({
  name: 'app-state:get',
  request: z.object({ key: z.string().min(1) }),
  response: z.object({ key: z.string(), value: z.unknown().nullable() })
})

export const appStateSetChannel = defineChannel({
  name: 'app-state:set',
  request: z.object({ key: z.string().min(1), value: z.unknown() }),
  response: z.object({ ok: z.boolean() })
})

export const utilityEchoChannel = defineChannel({
  name: 'utility:echo',
  request: z.object({ message: z.string() }),
  response: z.object({ echoed: z.string() })
})

/* ── Каналы доменов ── */

export const channels = {
  appHealth: appHealthChannel,
  appStateGet: appStateGetChannel,
  appStateSet: appStateSetChannel,
  utilityEcho: utilityEchoChannel,

  instrumentsList: instrumentsCrud.list,
  instrumentsCreate: instrumentsCrud.create,
  instrumentsUpdate: instrumentsCrud.update,
  instrumentsDelete: instrumentsCrud.delete,

  strainsList: strainsCrud.list,
  strainsCreate: strainsCrud.create,
  strainsUpdate: strainsCrud.update,
  strainsDelete: strainsCrud.delete,

  batchesList: defineChannel({
    name: 'batches:list',
    request: z.object({}),
    response: z.object({ items: z.array(batchDtoSchema) })
  }),
  batchesListArchived: defineChannel({
    name: 'batches:list-archived',
    request: z.object({}),
    response: z.object({ items: z.array(batchDtoSchema) })
  }),
  batchesCreate: defineChannel({
    name: 'batches:create',
    request: batchCreateSchema,
    response: z.object({ full: batchFullDtoSchema })
  }),
  batchesGet: defineChannel({
    name: 'batches:get',
    request: z.object({ id: z.string() }),
    response: z.object({ full: batchFullDtoSchema.nullable() })
  }),
  batchesUpdate: defineChannel({
    name: 'batches:update',
    request: z.object({
      id: z.string(),
      patch: z.object({
        title: z.string().min(1).optional(),
        rawMaterial: z.string().min(1).optional(),
        style: z.string().nullable().optional(),
        volumeLiters: z.number().positive().nullable().optional()
      })
    }),
    response: z.object({ full: batchFullDtoSchema.nullable() })
  }),
  batchesUpdateStatus: defineChannel({
    name: 'batches:update-status',
    request: z.object({ id: z.string(), to: batchStatusSchema, atUtc: z.string().optional() }),
    response: z.object({ full: batchFullDtoSchema.nullable() })
  }),
  batchesArchive: defineChannel({
    name: 'batches:archive',
    request: z.object({ id: z.string(), finalResult: finalResultSchema }),
    response: z.object({ full: batchFullDtoSchema.nullable() })
  }),
  batchesDelete: defineChannel({
    name: 'batches:delete',
    request: z.object({ id: z.string() }),
    response: z.object({ ok: z.boolean() })
  }),

  settingsGet: defineChannel({
    name: 'settings:get',
    request: z.object({}),
    response: z.object({ settings: settingsSchema })
  }),
  settingsSet: defineChannel({
    name: 'settings:set',
    request: z.object({ settings: settingsSchema }),
    response: z.object({ ok: z.boolean() })
  })
} as const

export type ChannelKey = keyof typeof channels

/** Тип запроса канала. */
export type ChannelRequest<K extends ChannelKey> = z.infer<
  (typeof channels)[K]['request']
>

/** Тип ответа канала. */
export type ChannelResponse<K extends ChannelKey> = z.infer<
  (typeof channels)[K]['response']
>

/**
 * Конверт результата invoke: main всегда отвечает этим объектом,
 * preload распаковывает его и превращает ошибку в исключение.
 */
export const ipcEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() })
  })
])

export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
