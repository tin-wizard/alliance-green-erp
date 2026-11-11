/** Master Data — shared client-safe types. */

export interface PageInput {
  search?: string
  page: number
  pageSize: number
}

export interface PageResult<T> {
  rows: T[]
  page: number
  pageSize: number
  total: number
}

export interface CustomerListRow {
  id: number
  sageCustomerId: number | null
  name: string
  city: string | null
  province: string | null
  contactName: string | null
  contactEmail: string | null
  siteCount: number
}

export interface CustomerDetail {
  id: number
  sageCustomerId: number | null
  name: string
  street: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  contactName: string | null
  contactNumber: string | null
  contactEmail: string | null
  salesperson: string | null
  isActive: boolean
  sites: Array<{
    id: number
    name: string
    street: string | null
    city: string | null
    province: string | null
  }>
  createdAt: string
  updatedAt: string
}

export interface SiteListRow {
  id: number
  sageSiteId: number | null
  name: string
  street: string | null
  city: string | null
  province: string | null
  customerId: number | null
  customerName: string | null
  warranty: boolean
  warrantyExpiresOn: string | null
}

export interface SiteDetail {
  id: number
  sageSiteId: number | null
  name: string
  street: string | null
  street2: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  contactName: string | null
  contactNumber: string | null
  customerId: number | null
  customerName: string | null
  warranty: boolean
  warrantyExpiresOn: string | null
  warrantyNotes: string | null
  notes: string | null
  dns: string | null
  lift: string | null
  mall: string | null
  isActive: boolean
  warranties: Array<{
    id: string
    description: string | null
    expiresOn: string | null
    documentKey: string | null
  }>
  createdAt: string
  updatedAt: string
}

export interface SubcontractorListRow {
  id: number
  sageSubcontractorId: number | null
  name: string
  city: string | null
  province: string | null
  contactEmail: string | null
  wsibValid: boolean
  wsibExpirationDate: string | null
  isActive: boolean
}

export interface SubcontractorDocumentView {
  id: string
  kind: 'wsib' | 'insurance' | 'other'
  documentType: string | null
  documentName: string | null
  fileName: string | null
  storageKey: string | null
  contentType: string | null
  sizeBytes: number | null
  checksumSha256: string | null
  expiresOn: string | null
  isExpired: boolean
  supersededAt: string | null
  uploadedAt: string
}

export interface SubcontractorDetail {
  id: number
  sageSubcontractorId: number | null
  name: string
  street: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  contactName: string | null
  contactNumber: string | null
  contactEmail: string | null
  email2: string | null
  email3: string | null
  rateInterior: string | null
  rateExterior: string | null
  rateOther: string | null
  isActive: boolean
  wsibValid: boolean
  wsibExpirationDate: string | null
  contacts: Array<{ id: string; contactName: string | null; phone: string | null; phoneExt: string | null }>
  documents: SubcontractorDocumentView[]
  createdAt: string
  updatedAt: string
}

export interface SupplierListRow {
  id: number
  name: string
  city: string | null
  province: string | null
  sageVendorId: number | null
  bypassPoApproval: boolean
  isUnderCls: boolean
  isActive: boolean
}

export interface SupplierDetail {
  id: number
  sageVendorId: number | null
  name: string
  address: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  contactPerson: string | null
  contactNumber: string | null
  additionalEmails: string | null
  additionalEmailsAccounting: string | null
  isUnderCls: boolean
  isOnlineVendor: boolean
  bypassPoApproval: boolean
  poNotes: string | null
  isActive: boolean
  contacts: Array<{
    id: string
    contactName: string | null
    phone: string | null
    phoneExt: string | null
    email: string | null
  }>
  createdAt: string
  updatedAt: string
}

export interface PartListRow {
  id: number
  partNumber: string
  name: string | null
  groupName: string | null
  sellPrice: string | null
  activeInSage: boolean
  subignore: boolean
}

export interface PartDetail {
  id: number
  partNumber: string
  name: string | null
  partGroupId: number | null
  groupName: string | null
  cost: string | null
  sellPrice: string | null
  sageItemId: number | null
  activeInSage: boolean
  subignore: boolean
  parentPartNumber: string | null
  clsLinkedPartCode: string | null
  warranty: string | null
  labourWarranty: string | null
  installCostPerUnit: string | null
  installProfitFormula: string | null
  recycleProfitFormula: string | null
  notes: string | null
  supplierRates: Array<{
    id: string
    supplierId: number | null
    supplierName: string | null
    costPrice: string | null
    sellPrice: string | null
    markup: string | null
    modelNumber1: string | null
    modelNumber2: string | null
    modelNumber3: string | null
    defaultRate: boolean
  }>
  sellingRates: Array<{
    id: string
    listId: number | null
    sellPrice: string | null
    installPrice: string | null
    recyclePrice: string | null
    dateInserted: string
  }>
  priceHistory: Array<{
    id: number
    fieldName: string
    lastValue: string | null
    newValue: string | null
    sectionName: string | null
    changedAt: string
  }>
  createdAt: string
  updatedAt: string
}
