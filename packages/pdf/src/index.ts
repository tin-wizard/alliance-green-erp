/**
 * `@cls/pdf` — server-side PDF rendering for the CLS Green ERP (ADR 0011).
 *
 * Modules build a versioned, Zod-validated view model and call `renderDocument`.
 * Nothing here imports database, auth, storage or module code, and no module
 * imports `@react-pdf/renderer` directly.
 */
export {
  renderDocument,
  countPdfPages,
  PdfRenderError,
  PDF_RENDER_CONCURRENCY,
} from './render'

export {
  PDF_REGISTRY,
  type PdfDocumentDefinition,
  type PdfDocumentRegistry,
} from './registry'

export {
  PDF_SCHEMA_VERSION,
  PDF_RENDERER_VERSION,
  DOCUMENT_KINDS,
  addressBlockDataSchema,
  decimalStringSchema,
  quoteLineSchema,
  quoteTotalsSchema,
  quoteDocumentDataSchema,
  packingSlipLineSchema,
  packingSlipDocumentDataSchema,
  type AddressBlockData,
  type DocumentData,
  type DocumentDataFor,
  type DocumentKind,
  type PackingSlipDocumentData,
  type PackingSlipLine,
  type QuoteDocumentData,
  type QuoteLine,
  type QuoteTotals,
} from './types'

export {
  LETTER_PAGE,
  PAGE_WIDTH,
  PAGE_HEIGHT,
  PAGE_MARGIN,
  CONTENT_WIDTH,
  FOOTER_HEIGHT,
  FONT_BODY,
  FONT_TITLE,
  COLORS,
  type PageSpec,
} from './theme'

export {
  FONT_DIR,
  FONT_FACES,
  FONT_FAMILIES,
  PdfFontError,
  assertFontsPresent,
  hyphenatePdfToken,
  missingFontFaces,
  registerPdfFonts,
  registeredFontFamilies,
  type FontFamily,
  type PdfFontFace,
} from './fonts'

export { QuoteDocument, type QuoteDocumentProps } from './documents/quote'
export { PackingSlipDocument, type PackingSlipDocumentProps } from './documents/packing-slip'

export { formatIsoDate, addressLines } from './format'
