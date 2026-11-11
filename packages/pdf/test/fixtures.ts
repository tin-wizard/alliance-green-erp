import type { PackingSlipDocumentData, QuoteDocumentData } from '../src/types'

/** Realistic quote snapshot used by tests and the sample render script. */
export function quoteFixture(overrides: Partial<QuoteDocumentData> = {}): QuoteDocumentData {
  return {
    schemaVersion: 1,
    kind: 'quote',
    number: 'Q-2026-0042',
    revision: '2',
    issuedOn: '2026-11-11',
    validUntil: '2026-12-11',
    customer: {
      name: 'Kelowna Cabinet Works',
      contact: 'Dana Whitfield',
      street: '1420 Ellis Street',
      city: 'Kelowna',
      province: 'BC',
      postalCode: 'V1Y 1Z9',
      phone: '250-555-0134',
    },
    shipTo: {
      name: 'Kelowna Cabinet Works — Shop',
      street: '9-2280 Leckie Road',
      city: 'Kelowna',
      province: 'BC',
      postalCode: 'V1X 6G3',
    },
    lines: [
      {
        position: 1,
        partNumber: 'AL-DL-24V-3000K-8FT',
        description: 'Linear LED tape light, 24 V, 3000 K, 8 ft reel',
        quantity: '12',
        unit: 'EA',
        unitPrice: '84.50',
        lineTotal: '1014.00',
      },
      {
        position: 2,
        partNumber: 'AL-PS-96W-24V',
        description: 'Dimmable LED driver, 96 W, 24 V, junction-box mount',
        quantity: '6',
        unit: 'EA',
        unitPrice: '142.25',
        lineTotal: '853.50',
      },
      {
        position: 3,
        partNumber: 'AL-CH-ALU-8FT',
        description: 'Extruded aluminum channel with frosted diffuser, 8 ft',
        quantity: '10',
        unit: 'EA',
        unitPrice: '99.60',
        lineTotal: '996.00',
      },
    ],
    totals: {
      subtotal: '2863.50',
      taxLabel: 'GST 5%',
      tax: '143.18',
      total: '3006.68',
    },
    notes: [
      'Lead time is three weeks from receipt of order.',
      'Prices are in Canadian dollars and exclude freight.',
    ],
    terms: ['Net 30 from invoice date.', 'Special order items are non-returnable.'],
    ...overrides,
  }
}

/** Realistic packing slip snapshot used by tests and the sample render script. */
export function packingSlipFixture(
  overrides: Partial<PackingSlipDocumentData> = {},
): PackingSlipDocumentData {
  return {
    schemaVersion: 1,
    kind: 'packing-slip',
    number: 'PS-2026-0187',
    issuedOn: '2026-11-13',
    shipDate: '2026-11-14',
    customer: {
      name: 'Kelowna Cabinet Works',
      contact: 'Dana Whitfield',
      street: '1420 Ellis Street',
      city: 'Kelowna',
      province: 'BC',
      postalCode: 'V1Y 1Z9',
      phone: '250-555-0134',
    },
    shipTo: {
      name: 'Kelowna Cabinet Works — Shop',
      street: '9-2280 Leckie Road',
      city: 'Kelowna',
      province: 'BC',
      postalCode: 'V1X 6G3',
    },
    lines: [
      {
        position: 1,
        partNumber: 'AL-DL-24V-3000K-8FT',
        description: 'Linear LED tape light, 24 V, 3000 K, 8 ft reel',
        quantity: '12',
        unit: 'EA',
        shipped: '12',
        backorder: '0',
      },
      {
        position: 2,
        partNumber: 'AL-PS-96W-24V',
        description: 'Dimmable LED driver, 96 W, 24 V, junction-box mount',
        quantity: '6',
        unit: 'EA',
        shipped: '4',
        backorder: '2',
      },
      {
        position: 3,
        partNumber: 'AL-CH-ALU-8FT',
        description: 'Extruded aluminum channel with frosted diffuser, 8 ft',
        quantity: '10',
        unit: 'EA',
        shipped: '10',
        backorder: '0',
      },
    ],
    notes: ['Backordered items follow on a second shipment.'],
    ...overrides,
  }
}
