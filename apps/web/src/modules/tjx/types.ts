/** DTOs shared by the TJX master-data screens and their server functions. */

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
