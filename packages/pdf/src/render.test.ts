import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ZodError } from 'zod'
import {
  PDF_SCHEMA_VERSION,
  PdfFontError,
  assertFontsPresent,
  countPdfPages,
  hyphenatePdfToken,
  missingFontFaces,
  packingSlipDocumentDataSchema,
  quoteDocumentDataSchema,
  renderDocument,
} from './index'
import { packingSlipFixture, quoteFixture } from '../test/fixtures'

const MEDIA_BOX = /\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/

function firstQuoteLine() {
  const line = quoteFixture().lines[0]
  if (!line) throw new Error('quote fixture has no lines')
  return line
}

describe('DTO validation', () => {
  test('accepts a complete quote snapshot and keeps decimal strings exactly', () => {
    const parsed = quoteDocumentDataSchema.parse({
      ...quoteFixture(),
      lines: [{ ...firstQuoteLine(), unitPrice: '1234.5000', quantity: '0.00' }],
    })
    expect(parsed.schemaVersion).toBe(PDF_SCHEMA_VERSION)
    expect(parsed.kind).toBe('quote')
    expect(parsed.lines[0]?.unitPrice).toBe('1234.5000')
    expect(parsed.lines[0]?.quantity).toBe('0.00')
  })

  test('accepts a complete packing slip snapshot', () => {
    const parsed = packingSlipDocumentDataSchema.parse(packingSlipFixture())
    expect(parsed.kind).toBe('packing-slip')
    expect(parsed.lines[1]?.backorder).toBe('2')
  })

  test('rejects an unknown schema version', () => {
    const result = quoteDocumentDataSchema.safeParse({ ...quoteFixture(), schemaVersion: 2 })
    expect(result.success).toBe(false)
  })

  test('rejects a kind that does not match the schema', () => {
    const result = quoteDocumentDataSchema.safeParse({ ...quoteFixture(), kind: 'packing-slip' })
    expect(result.success).toBe(false)
  })

  test.each(['12,34', '1.2.3', 'CAD 12.50', '', 'NaN', '1e3'])(
    'rejects malformed amount %o',
    (amount) => {
      const fixture = quoteFixture()
      const line = firstQuoteLine()
      const result = quoteDocumentDataSchema.safeParse({
        ...fixture,
        lines: [{ ...line, unitPrice: amount }],
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.join('.') === 'lines.0.unitPrice')).toBe(
          true,
        )
      }
    },
  )

  test('rejects a malformed issued date', () => {
    const result = quoteDocumentDataSchema.safeParse({ ...quoteFixture(), issuedOn: '11/11/2026' })
    expect(result.success).toBe(false)
  })

  test('allows negative quantities where the domain allows them', () => {
    const fixture = quoteFixture()
    const line = firstQuoteLine()
    const result = quoteDocumentDataSchema.safeParse({
      ...fixture,
      lines: [{ ...line, quantity: '-2.5' }],
    })
    expect(result.success).toBe(true)
  })
})

describe('fonts', () => {
  test('all vendored faces are present', () => {
    expect(missingFontFaces()).toEqual([])
    expect(() => assertFontsPresent()).not.toThrow()
  })

  test('a missing face throws a clear startup error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cls-pdf-fonts-'))
    try {
      expect(() => assertFontsPresent(dir)).toThrow(PdfFontError)
      expect(() => assertFontsPresent(dir)).toThrow(/InstrumentSans-Regular\.ttf/)
      expect(() => assertFontsPresent(dir)).toThrow(/will not fall back to Helvetica/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('hyphenation keeps ordinary part numbers and money intact', () => {
    expect(hyphenatePdfToken('AL-DL-24V-3000K-8FT')).toEqual(['AL-DL-24V-3000K-8FT'])
    expect(hyphenatePdfToken('3006.68')).toEqual(['3006.68'])
    expect(hyphenatePdfToken('V1Y 1Z9')).toEqual(['V1Y 1Z9'])
  })

  test('only an oversized unbroken token is chunked for wrapping', () => {
    const token = 'X'.repeat(120)
    const parts = hyphenatePdfToken(token)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).toBe(token)
  })
})

describe('renderDocument', () => {
  test('renders a quote to Letter PDF bytes', async () => {
    const buffer = await renderDocument('quote', quoteFixture())
    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buffer.toString('latin1')).toMatch(MEDIA_BOX)
    expect(countPdfPages(buffer)).toBeGreaterThanOrEqual(1)
  })

  test('renders a packing slip to Letter PDF bytes', async () => {
    const buffer = await renderDocument('packing-slip', packingSlipFixture())
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buffer.toString('latin1')).toMatch(MEDIA_BOX)
    expect(countPdfPages(buffer)).toBeGreaterThanOrEqual(1)
  })

  test('embeds both font families and never falls back to Helvetica', async () => {
    const bytes = (await renderDocument('quote', quoteFixture())).toString('latin1')
    expect(bytes).toContain('InstrumentSans-Regular')
    expect(bytes).toContain('LibreCaslonText-Regular')
    expect(bytes).not.toContain('Helvetica')
  })

  test('writes the required PDF metadata', async () => {
    const bytes = (await renderDocument('quote', quoteFixture())).toString('latin1')
    expect(bytes).toContain('Alliance Lighting')
    expect(bytes).toContain('CLS Green ERP')
    expect(bytes).toContain('en-CA')
    expect(bytes).toContain('Quotation Q-2026-0042')
    expect(bytes).toContain('quote Q-2026-0042')
  })

  test('is deterministic across two renders of the same DTO', async () => {
    const first = await renderDocument('quote', quoteFixture())
    const second = await renderDocument('quote', quoteFixture())
    expect(first.equals(second)).toBe(true)
  })

  test('paginates a long document and repeats the table across pages', async () => {
    const fixture = quoteFixture()
    const base = fixture.lines
    const lines = Array.from({ length: 120 }, (_, index) => {
      const source = base[index % base.length]
      if (!source) throw new Error('fixture line missing')
      return {
        ...source,
        position: index + 1,
        description: `${source.description} (item ${index + 1})`,
      }
    })
    const buffer = await renderDocument('quote', { ...fixture, lines })
    expect(countPdfPages(buffer)).toBeGreaterThanOrEqual(2)
  })

  test('renders accented French text without a font fallback', async () => {
    const buffer = await renderDocument('quote', {
      ...quoteFixture(),
      lines: [
        {
          ...firstQuoteLine(),
          description: 'Câblage préfabriqué — 48 po, fini blanc, garanti 5 ans',
        },
      ],
    })
    const bytes = buffer.toString('latin1')
    expect(bytes).not.toContain('Helvetica')
    expect(countPdfPages(buffer)).toBeGreaterThanOrEqual(1)
  })

  test('does not crash on a very long unbroken part number', async () => {
    const fixture = quoteFixture()
    const line = fixture.lines[0]
    if (!line) throw new Error('fixture line missing')
    const buffer = await renderDocument('quote', {
      ...fixture,
      lines: [
        {
          ...line,
          partNumber: `AL-${'9'.repeat(140)}`,
          description: 'Continuously wound reel with an unbroken catalogue token '.repeat(3),
        },
      ],
    })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(countPdfPages(buffer)).toBeGreaterThanOrEqual(1)
  })

  test('rejects a DTO that fails validation before rendering', async () => {
    const invalid = {
      ...quoteFixture(),
      totals: { ...quoteFixture().totals, total: '12,00' },
    }
    await expect(
      renderDocument('quote', invalid as unknown as ReturnType<typeof quoteFixture>),
    ).rejects.toBeInstanceOf(ZodError)
  })

  test('renders concurrent requests identically under the render cap', async () => {
    const expected = await renderDocument('quote', quoteFixture())
    const results = await Promise.all(
      Array.from({ length: 5 }, () => renderDocument('quote', quoteFixture())),
    )
    for (const buffer of results) {
      expect(buffer.equals(expected)).toBe(true)
    }
  })
})
