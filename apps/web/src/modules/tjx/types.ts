/** DTOs shared by the TJX master-data screens and their server functions. */
import type { TjxGridType, TjxPaymentTerms, TjxQuoteType } from './lib/lifecycle'

export interface TjxRoomRow {
  id: number
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  usedByTemplates: string[]
}

export interface TjxTemplateRoomRow {
  roomId: number
  roomName: string
  sortOrder: number
}

export interface TjxTemplateRow {
  id: number
  name: string
  isDefault: boolean
  notes: string | null
  roomCount: number
  updatedAt: string
}

export interface TjxTemplateDetail extends TjxTemplateRow {
  rooms: TjxTemplateRoomRow[]
}

export interface TjxFixturePartRow {
  id: number
  partNo: string
  partType: string
  markup: string
  ratioPerFixture: string
  sortOrder: number
}

export interface TjxFixtureRow {
  id: number
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  partCount: number
}

export interface TjxFixtureDetail extends TjxFixtureRow {
  parts: TjxFixturePartRow[]
}

export interface TjxRateRow {
  partNo: string
  installCostPerUnit: string
  updatedAt: string
}

export interface TjxPartOption {
  partNumber: string
  name: string | null
  sellPrice: string | null
}

export interface TjxSubcontractorOption {
  id: number
  name: string
}

/* --------------------------------- quotes ---------------------------------- */

export type TjxQuotePriceSource = 'snapshot' | 'override' | 'imported'

export interface TjxQuoteListRow {
  id: number
  status: number
  statusLabel: string
  siteId: number | null
  siteName: string | null
  customerName: string | null
  quoteType: TjxQuoteType
  gridType: TjxGridType | null
  paymentTermsCode: TjxPaymentTerms | null
  subtotal: string
  tax: string
  total: string
  withoutMarkupSubtotal: string
  withoutMarkupTax: string
  withoutMarkupTotal: string
  revisionNo: number
  roomCount: number
  fixtureCount: number
  updatedAt: string
}

export interface TjxQuoteListFilters {
  status?: number
  search?: string
}

export interface TjxQuotePriceRow {
  partNo: string
  price: string
  previousPrice: string | null
  source: TjxQuotePriceSource
}

export interface TjxQuotePartRow {
  partNo: string
  description: string | null
  qtyWithMarkup: string
  qtyWithoutMarkup: string
  unitPrice: string
  lineSubtotal: string
  lineSubtotalWithoutMarkup: string
  sortOrder: number
}

export interface TjxQuoteSpecialPartRow {
  id: number
  name: string
  quantity: string
  unitPrice: string
  lineSubtotal: string
  sortOrder: number
}

export interface TjxQuoteFixturePartRow {
  id: number
  partNo: string
  partType: string
  markup: string
  ratioPerFixture: string
  sortOrder: number
}

export interface TjxQuoteFixtureRow {
  id: number
  fixtureId: number | null
  fixtureName: string
  quantity: string
  sortOrder: number
  parts: TjxQuoteFixturePartRow[]
}

export interface TjxQuoteRoomRow {
  id: number
  roomId: number | null
  roomName: string
  sortOrder: number
  fixtures: TjxQuoteFixtureRow[]
}

export interface TjxQuoteDetail {
  id: number
  status: number
  statusLabel: string
  version: number
  quoteType: TjxQuoteType
  ceilingGridType: TjxGridType | null
  isTypeMaintenance: boolean
  paymentTermsCode: TjxPaymentTerms | null
  dueDate: string | null
  siteId: number | null
  siteName: string | null
  customerId: number | null
  customerName: string | null
  shipToType: string | null
  shipContactName: string | null
  shipCompany: string | null
  shipStreet1: string | null
  shipStreet2: string | null
  shipCity: string | null
  shipProvince: string | null
  shipPostalCode: string | null
  shipPhone: string | null
  shippingAddress: string | null
  taxCode: string | null
  taxProvince: string | null
  appliedTaxRate: string | null
  notes: string | null
  pdfNotes: string | null
  revisionNotes: string | null
  revisionNo: number
  subtotal: string
  tax: string
  total: string
  withoutMarkupSubtotal: string
  withoutMarkupTax: string
  withoutMarkupTotal: string
  canEdit: boolean
  createdAt: string
  updatedAt: string
  rooms: TjxQuoteRoomRow[]
  parts: TjxQuotePartRow[]
  prices: TjxQuotePriceRow[]
  specialParts: TjxQuoteSpecialPartRow[]
}

export interface TjxQuoteFixturePartInput {
  partNo: string
  partType: string
  markup: string
  ratioPerFixture: string
}

export interface TjxQuoteFixtureInput {
  fixtureId: number | null
  fixtureName: string
  quantity: string
  parts: TjxQuoteFixturePartInput[]
}

export interface TjxQuoteRoomInput {
  roomId: number | null
  roomName: string
  fixtures: TjxQuoteFixtureInput[]
}

export interface TjxQuoteSpecialPartInput {
  name: string
  quantity: string
  unitPrice: string
}

export interface TjxQuotePriceOverrideInput {
  partNo: string
  price: string
}

/** Header shared by create and save. Totals are always server-calculated. */
export interface TjxQuoteHeaderInput {
  siteId: number
  quoteType: TjxQuoteType
  ceilingGridType: TjxGridType | null
  isTypeMaintenance: boolean
  paymentTermsCode: TjxPaymentTerms | null
  dueDate: string | null
  taxProvince: string | null
  appliedTaxRate: string | null
  shipToType: string | null
  shipContactName: string | null
  shipCompany: string | null
  shipStreet1: string | null
  shipStreet2: string | null
  shipCity: string | null
  shipProvince: string | null
  shipPostalCode: string | null
  shipPhone: string | null
  shippingAddress: string | null
  notes: string | null
  pdfNotes: string | null
}

export type TjxQuoteCreateInput = TjxQuoteHeaderInput

export interface TjxQuoteSaveInput extends TjxQuoteHeaderInput {
  id: number
  version: number
  revisionNotes: string | null
  rooms: TjxQuoteRoomInput[]
  specialParts: TjxQuoteSpecialPartInput[]
  priceOverrides: TjxQuotePriceOverrideInput[]
}

export interface TjxPdfResult {
  documentId: string
  url: string | null
  sha256: string
  byteSize: number
  pageCount: number | null
}

export interface TjxGeneratedDocument {
  id: string
  kind: string
  schemaVersion: number
  sha256: string
  byteSize: number
  pageCount: number | null
  createdAt: string
  url: string | null
}

