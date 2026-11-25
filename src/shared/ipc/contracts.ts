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
  calibrationOffsetSg: z.number().nullable().optional(),
  /** Калибровочная температура ареометра T_кал, °C (vision, дефолт 20). */
  calibrationTempC: z.number().min(0).max(30).nullable().optional()
})
export type InstrumentInput = z.infer<typeof instrumentInputSchema>

export const instrumentDtoSchema = instrumentInputSchema.extend({
  id: z.string(),
  calibrationTempC: z.number().nullable().optional(),
  calibrationPair: z
    .object({
      refrBrix: z.number(),
      hydrometerSg: z.number(),
      wcf: z.number(),
      atUtc: z.string()
    })
    .nullable()
    .optional(),
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
  doseUnit: z.enum(['g', 'ml', 'packet', 'tablet']),
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

export const operationKindSchema = z.enum([
  'rack',
  'transfer',
  'sugar',
  'acid',
  'nutrient',
  'fining',
  'bottling',
  'other'
])
export type OperationKind = z.infer<typeof operationKindSchema>

export const operationInputSchema = z.object({
  batchId: z.string().min(1),
  kind: operationKindSchema,
  atUtc: z.string(),
  notes: z.string().nullable().optional()
})
export type OperationInput = z.infer<typeof operationInputSchema>

export const operationDtoSchema = operationInputSchema.extend({
  id: z.string(),
  createdAtUtc: z.string(),
  updatedAtUtc: z.string()
})
export type OperationDto = z.infer<typeof operationDtoSchema>

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

/* ── Замеры (design add-measurements-correction D1, D4) ── */

export const measurementKindSchema = z.enum(['density', 'temperature', 'ph'])
export type MeasurementKind = z.infer<typeof measurementKindSchema>

export const correctionStepSchema = z.object({
  type: z.string(),
  input: z.number(),
  output: z.number(),
  note: z.string().optional()
})
export type CorrectionStepDto = z.infer<typeof correctionStepSchema>

export const correctionsSchema = z.object({
  steps: z.array(correctionStepSchema),
  warnings: z.array(z.string())
})
export type CorrectionsDto = z.infer<typeof correctionsSchema>

export const measurementDtoSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  kind: measurementKindSchema,
  instrumentId: z.string().nullable(),
  rawValue: z.number(),
  unit: z.enum(['sg', 'brix']),
  tempC: z.number().nullable(),
  correctedSg: z.number().nullable(),
  correctedBrix: z.number().nullable(),
  corrections: correctionsSchema,
  measuredAtUtc: z.string(),
  notes: z.string().nullable(),
  createdAtUtc: z.string(),
  updatedAtUtc: z.string()
})
export type MeasurementDto = z.infer<typeof measurementDtoSchema>

const measurementBaseSchema = z.object({
  batchId: z.string().min(1),
  kind: measurementKindSchema,
  instrumentId: z.string().nullable().optional(),
  rawValue: z.number(),
  unit: z.enum(['sg', 'brix']),
  tempC: z.number().nullable().optional(),
  measuredAtUtc: z.string(),
  notes: z.string().nullable().optional()
})

export const measurementCreateSchema = measurementBaseSchema.superRefine((input, issues) => {
    if (input.kind === 'density') {
      // Спека 2.2: у замера плотности обязан быть прибор.
      if (!input.instrumentId) {
        issues.addIssue({
          code: 'custom',
          path: ['instrumentId'],
          message: 'Для замера плотности укажите прибор'
        })
      }
      const outOfRange =
        input.unit === 'brix'
          ? input.rawValue < 0 || input.rawValue > 80
          : input.rawValue < 0.9 || input.rawValue > 1.2
      if (outOfRange) {
        issues.addIssue({
          code: 'custom',
          path: ['rawValue'],
          message: 'Показание вне физического диапазона (Brix 0–80, SG 0.9–1.2)'
        })
      }
    }
    if (input.kind === 'temperature' && (input.rawValue < -5 || input.rawValue > 60)) {
      issues.addIssue({
        code: 'custom',
        path: ['rawValue'],
        message: 'Температура вне допустимого диапазона (−5…60 °C)'
      })
    }
    if (input.kind === 'ph' && (input.rawValue < 0 || input.rawValue > 14)) {
      issues.addIssue({
        code: 'custom',
        path: ['rawValue'],
        message: 'pH вне допустимого диапазона (0–14)'
      })
    }
  })
export type MeasurementCreateInput = z.infer<typeof measurementBaseSchema>

export const measurementPatchSchema = measurementBaseSchema.partial()
export type MeasurementPatch = z.infer<typeof measurementPatchSchema>

export const measurementRevisionDtoSchema = z.object({
  id: z.string(),
  measurementId: z.string(),
  action: z.enum(['update', 'delete']),
  snapshot: measurementDtoSchema.partial(),
  revisedAtUtc: z.string()
})
export type MeasurementRevisionDto = z.infer<typeof measurementRevisionDtoSchema>

export const calibrateSchema = z.object({
  instrumentId: z.string().min(1),
  refrBrix: z.number().min(0).max(80),
  hydrometerSg: z.number().min(0.9).max(1.2)
})
export type CalibrateInput = z.infer<typeof calibrateSchema>

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
const operationsCrud = crudChannels('operations', operationInputSchema, operationDtoSchema)

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
  batchesExport: defineChannel({
    name: 'batches:export',
    request: z.object({ id: z.string().min(1) }),
    response: z.object({ path: z.string().nullable() })
  }),
  batchesSetYeast: defineChannel({
    name: 'batches:set-yeast',
    request: z.object({ batchId: z.string().min(1), yeast: z.array(yeastInputSchema) }),
    response: z.object({ full: batchFullDtoSchema.nullable() })
  }),
  batchesSetAdditions: defineChannel({
    name: 'batches:set-additions',
    request: z.object({ batchId: z.string().min(1), additions: z.array(additionInputSchema) }),
    response: z.object({ full: batchFullDtoSchema.nullable() })
  }),

  operationsListByBatch: defineChannel({
    name: 'operations:list-by-batch',
    request: z.object({ batchId: z.string().min(1) }),
    response: z.object({ items: z.array(operationDtoSchema) })
  }),
  operationsCreate: operationsCrud.create,
  operationsUpdate: operationsCrud.update,
  operationsDelete: operationsCrud.delete,

  settingsGet: defineChannel({
    name: 'settings:get',
    request: z.object({}),
    response: z.object({ settings: settingsSchema })
  }),
  settingsSet: defineChannel({
    name: 'settings:set',
    request: z.object({ settings: settingsSchema }),
    response: z.object({ ok: z.boolean() })
  }),

  measurementsListByBatch: defineChannel({
    name: 'measurements:list-by-batch',
    request: z.object({ batchId: z.string().min(1) }),
    response: z.object({ items: z.array(measurementDtoSchema) })
  }),
  measurementsCreate: defineChannel({
    name: 'measurements:create',
    request: measurementCreateSchema,
    response: z.object({ item: measurementDtoSchema })
  }),
  measurementsUpdate: defineChannel({
    name: 'measurements:update',
    request: z.object({ id: z.string().min(1), patch: measurementPatchSchema }),
    response: z.object({ item: measurementDtoSchema.nullable() })
  }),
  measurementsDelete: defineChannel({
    name: 'measurements:delete',
    request: z.object({ id: z.string().min(1) }),
    response: z.object({ ok: z.boolean() })
  }),
  measurementsRevisions: defineChannel({
    name: 'measurements:revisions',
    request: z.object({ id: z.string().min(1) }),
    response: z.object({ items: z.array(measurementRevisionDtoSchema) })
  }),
  instrumentsCalibrate: defineChannel({
    name: 'instruments:calibrate',
    request: calibrateSchema,
    response: z.object({ item: instrumentDtoSchema })
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
