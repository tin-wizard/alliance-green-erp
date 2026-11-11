import { z } from 'zod'

/** Client-safe validation schema (used by the form and by the RPC validator). */
export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
})

export type LoginInput = z.infer<typeof loginSchema>
