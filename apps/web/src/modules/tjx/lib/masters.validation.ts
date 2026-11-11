import { z } from 'zod'

const name = z.string().trim().min(1, 'Enter a name.').max(80, 'Use 80 characters or fewer.')
const description = z.string().trim().max(2000).nullish()
const integerOrder = z.coerce.number().int().min(0).max(100_000)

const factor = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, 'Use a number with at most 4 decimal places.')
  .refine((value) => Number(value) > 0, 'Markup must be greater than zero.')

const ratio = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, 'Use a number with at most 4 decimal places.')

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use a non-negative amount with at most 2 decimal places.')

const partNo = z
  .string()
  .trim()
  .min(1, 'Enter a part number.')
  .max(50, 'Use 50 characters or fewer.')
  .transform((value) => value.toUpperCase())

const partType = z.enum(['Ballast', 'Lamp', ''])

export const listRoomSchema = z.object({
  search: z.string().trim().max(100).optional(),
  active: z.enum(['all', 'active', 'inactive']).default('all'),
})

export const saveRoomSchema = z.object({
  id: z.number().int().positive().optional(),
  name,
  description,
  sortOrder: integerOrder.default(0),
  isActive: z.boolean().default(true),
})

export const setRoomActiveSchema = z.object({
  id: z.number().int().positive(),
  isActive: z.boolean(),
})

export const listTemplateSchema = z.object({
  search: z.string().trim().max(100).optional(),
})

export const templateIdSchema = z.object({ id: z.number().int().positive() })

export const saveTemplateSchema = z.object({
  id: z.number().int().positive().optional(),
  name,
  notes: description,
  isDefault: z.boolean().default(false),
  roomIds: z.array(z.number().int().positive()).max(500).default([]),
})

export const deleteTemplateSchema = z.object({ id: z.number().int().positive() })

export const listFixtureSchema = z.object({
  search: z.string().trim().max(100).optional(),
  active: z.enum(['all', 'active', 'inactive']).default('all'),
})

export const fixtureIdSchema = z.object({ id: z.number().int().positive() })

export const fixturePartSchema = z.object({
  partNo,
  partType: partType.default(''),
  markup: factor,
  ratioPerFixture: ratio,
  sortOrder: integerOrder.default(0),
})

export const saveFixtureSchema = z.object({
  id: z.number().int().positive().optional(),
  name,
  description,
  sortOrder: integerOrder.default(0),
  isActive: z.boolean().default(true),
  parts: z.array(fixturePartSchema).min(1, 'Add at least one part.').max(200),
})

export const setFixtureActiveSchema = z.object({
  id: z.number().int().positive(),
  isActive: z.boolean(),
})

export const partSearchSchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(50).default(20),
})

export const listRateSchema = z.object({
  subcontractorId: z.number().int().positive(),
  search: z.string().trim().max(100).optional(),
})

export const saveRatesSchema = z.object({
  subcontractorId: z.number().int().positive(),
  rates: z
    .array(
      z.object({
        partNo,
        installCostPerUnit: money,
      }),
    )
    .max(500),
})

export type SaveRoomInput = z.infer<typeof saveRoomSchema>
export type SaveTemplateInput = z.infer<typeof saveTemplateSchema>
export type SaveFixtureInput = z.infer<typeof saveFixtureSchema>
export type SaveRatesInput = z.infer<typeof saveRatesSchema>
