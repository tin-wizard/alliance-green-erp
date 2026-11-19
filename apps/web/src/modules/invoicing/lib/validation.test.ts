import { describe, expect, test } from 'vitest'
import { previewInvoiceSchema, saveInvoiceSchema } from './validation'

const line = { partNo: '---', qty: '1', price: '5.00', isLocalPart: false }

describe('invoice part placeholder', () => {
  test('save rejects the --- placeholder', () => {
    const parsed = saveInvoiceSchema.shape.parts.safeParse([line])
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toMatch(/placeholder/i)
  })

  test('preview rejects the --- placeholder', () => {
    const parsed = previewInvoiceSchema.shape.parts.safeParse([line])
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toMatch(/placeholder/i)
  })
})
