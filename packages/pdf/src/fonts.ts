/**
 * Font registration for `@cls/pdf` (ADR 0011).
 *
 * The two families are vendored static TTFs under `packages/pdf/fonts` with
 * their OFL licences. Registration runs once at module load. A missing face
 * throws `PdfFontError` here (and again, cheaply, before every render); the
 * renderer never falls back to Helvetica or fetches a font over the network.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Font } from '@react-pdf/renderer'

export const FONT_DIR = fileURLToPath(new URL('../fonts/', import.meta.url))

export const FONT_FAMILIES = ['Instrument Sans', 'Libre Caslon Text'] as const

export type FontFamily = (typeof FONT_FAMILIES)[number]

export interface PdfFontFace {
  readonly family: FontFamily
  readonly weight: 400 | 500 | 600
  readonly file: string
}

/** Body 400/500/600; titles and customer-facing headings 400. */
export const FONT_FACES: readonly PdfFontFace[] = [
  { family: 'Instrument Sans', weight: 400, file: 'InstrumentSans-Regular.ttf' },
  { family: 'Instrument Sans', weight: 500, file: 'InstrumentSans-Medium.ttf' },
  { family: 'Instrument Sans', weight: 600, file: 'InstrumentSans-SemiBold.ttf' },
  { family: 'Libre Caslon Text', weight: 400, file: 'LibreCaslonText-Regular.ttf' },
]

export class PdfFontError extends Error {
  readonly code = 'pdf_font_missing'

  constructor(message: string) {
    super(message)
    this.name = 'PdfFontError'
  }
}

/** Files from the expected face list that are absent from `dir`. */
export function missingFontFaces(dir: string = FONT_DIR): string[] {
  return FONT_FACES.filter((face) => !existsSync(join(dir, face.file))).map((face) => face.file)
}

/** Throws a startup-style error when a vendored face is missing. */
export function assertFontsPresent(dir: string = FONT_DIR): void {
  const missing = missingFontFaces(dir)
  if (missing.length === 0) return
  throw new PdfFontError(
    `@cls/pdf cannot render: ${missing.length} bundled font face(s) missing from ${dir}. ` +
      `Expected ${missing.join(', ')}. Restore them from packages/pdf/fonts ` +
      `(licences ship beside the files); the renderer will not fall back to Helvetica.`,
  )
}

const MAX_UNBROKEN_TOKEN = 32
const TOKEN_CHUNK = 16

/**
 * Hyphenation is restricted: part numbers, postal codes and money are kept
 * intact. Only a token too long to fit any column is chunked so it wraps
 * visibly instead of running off the page and disappearing.
 */
export function hyphenatePdfToken(word: string): string[] {
  if (word.length <= MAX_UNBROKEN_TOKEN) return [word]
  const chunks: string[] = []
  for (let index = 0; index < word.length; index += TOKEN_CHUNK) {
    chunks.push(word.slice(index, index + TOKEN_CHUNK))
  }
  return chunks
}

/** Diagnostics: families currently registered with the renderer. */
export function registeredFontFamilies(): string[] {
  return Object.keys(Font.getRegisteredFonts())
}

let registered = false

/** Registers the vendored faces once. Safe to call repeatedly. */
export function registerPdfFonts(): void {
  if (registered) return
  assertFontsPresent()
  for (const family of FONT_FAMILIES) {
    const fonts = FONT_FACES.filter((face) => face.family === family).map((face) => ({
      src: join(FONT_DIR, face.file),
      fontWeight: face.weight,
    }))
    Font.register({ family, fonts })
  }
  Font.registerHyphenationCallback(hyphenatePdfToken)
  registered = true
}

registerPdfFonts()
