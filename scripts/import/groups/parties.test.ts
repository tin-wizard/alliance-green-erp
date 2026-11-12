/**
 * Group 2 — parties.
 *
 * The nasty cases are the point: an orphan site keeps its row with a NULL parent,
 * blank money becomes NULL (never 0), a contact with no vendor is not inserted, and
 * a conflicting Sage vendor id fails loudly instead of one supplier silently losing
 * its link.
 */
import { and, eq, inArray, like } from 'drizzle-orm'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { getDb } from '@cls/db'
import { getConfig } from '@cls/core/env.server'
import {
  customers,
  migrationExceptions,
  migrationRowMap,
  subcontractorContacts,
  subcontractors,
  suppliers,
  sites,
} from '@cls/db/schema'
import { runTransformerRow } from '../testing'
import { transformer } from './parties'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

const configured = (() => {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
})()

const marker = `pt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/**
 * Legacy ids are small; 2.0-2.1e9 is inside int4 and outside anything the dump
 * issues, so a stray run cannot collide with a real migrated row.
 */
const base = 2_000_000_000 + Math.floor(Math.random() * 900_000)
const customerId = base
const siteId = base + 1
const orphanSiteId = base + 2
const subcontractorId = base + 3
const supplierId = base + 4
const rivalSupplierId = base + 5
const missingSiteId = base + 6

async function crosswalkFor(entity: string, sourceKey: string) {
  const [row] = await getDb()
    .select()
    .from(migrationRowMap)
    .where(and(eq(migrationRowMap.entity, entity), eq(migrationRowMap.sourceKey, sourceKey)))
    .limit(1)
  return row ?? null
}

async function exceptionFor(exceptionClass: string, entity: string, sourceKey: string) {
  const [row] = await getDb()
    .select()
    .from(migrationExceptions)
    .where(
      and(
        eq(migrationExceptions.exceptionClass, exceptionClass),
        eq(migrationExceptions.entity, entity),
        eq(migrationExceptions.sourceKey, sourceKey),
      ),
    )
    .limit(1)
  return row ?? null
}

async function transform(table: string, sourceKey: string, row: Record<string, string | null>) {
  await getDb().transaction(async (tx) => {
    await runTransformerRow(tx, transformer, { group: 'parties', table, sourceKey, row })
  })
}

afterAll(async () => {
  if (!configured) return
  const db = getDb()
  await db
    .delete(subcontractorContacts)
    .where(inArray(subcontractorContacts.subcontractorId, [subcontractorId]))
  await db.delete(sites).where(inArray(sites.id, [siteId, orphanSiteId]))
  await db.delete(customers).where(eq(customers.id, customerId))
  await db.delete(subcontractors).where(eq(subcontractors.id, subcontractorId))
  await db.delete(suppliers).where(inArray(suppliers.id, [supplierId, rivalSupplierId]))
  await db.delete(migrationRowMap).where(like(migrationRowMap.sourceKey, `%${marker}%`))
  await db.delete(migrationExceptions).where(like(migrationExceptions.sourceKey, `%${marker}%`))
})

describe.skipIf(!configured)('parties group', () => {
  test('a customer keeps its legacy id as the Sage link', async () => {
    const sourceKey = `customer:${marker}:${customerId}`
    await transform('customer', sourceKey, {
      id: String(customerId),
      name: `Customer ${marker}`,
      street: '1 Main St',
      city: 'Toronto',
      province: 'ON',
      postalcode: 'M5V 1A1',
      cname: 'Pat Contact',
      cnumber: '555-0100',
      cemail1: 'ap@example.test',
      salesp: 'Sam',
    })

    const [row] = await getDb().select().from(customers).where(eq(customers.id, customerId))
    expect(row?.sageCustomerId).toBe(customerId)
    expect(row?.name).toBe(`Customer ${marker}`)
    expect(row?.contactEmail).toBe('ap@example.test')
    expect(row?.salesperson).toBe('Sam')

    const mapped = await crosswalkFor('customer', sourceKey)
    expect(mapped?.targetTable).toBe('customers')
    expect(mapped?.targetKey).toBe(String(customerId))
  })

  test('a site with a migrated parent points at it', async () => {
    const sourceKey = `sites:${marker}:${siteId}`
    await transform('sites', sourceKey, {
      id: String(siteId),
      custid: String(customerId),
      name: `Site ${marker}`,
      street: '2 Main St',
      street_2: 'Unit 5',
      city: 'Toronto',
      province: 'ON',
      postalcode: 'M5V 1A2',
      cname: 'Site Contact',
      cnumber: '555-0101',
      warranty: '1',
      warranty_exp: '2027-05-01',
      warranty_notes: 'Two year warranty',
      notes: 'Roof access via loading dock',
      dns: 'DNS-4',
      lift: '2',
      mall: 'Yorkdale',
    })

    const [row] = await getDb().select().from(sites).where(eq(sites.id, siteId))
    expect(row?.customerId).toBe(customerId)
    expect(row?.sageSiteId).toBe(siteId)
    expect(row?.warranty).toBe(true)
    expect(row?.warrantyExpiresOn).toBe('2027-05-01')
    expect(row?.street2).toBe('Unit 5')
    expect(row?.lift).toBe('2')
    expect(await exceptionFor('orphan_site_customer', 'site', sourceKey)).toBeNull()
  })

  test('a site whose customer was never imported keeps a NULL parent', async () => {
    const sourceKey = `sites:${marker}:${orphanSiteId}`
    await transform('sites', sourceKey, {
      id: String(orphanSiteId),
      custid: String(base + 900),
      name: `Orphan site ${marker}`,
      street: '3 Main St',
      city: 'Toronto',
      province: 'ON',
      warranty: '0',
    })

    const [row] = await getDb().select().from(sites).where(eq(sites.id, orphanSiteId))
    expect(row?.customerId).toBeNull()
    expect(row?.name).toBe(`Orphan site ${marker}`)

    const recorded = await exceptionFor('orphan_site_customer', 'site', sourceKey)
    expect(recorded?.migrationAction).toContain('customer_id = NULL')
  })

  test('subcontractor rates parse money and a blank rate stays NULL', async () => {
    const sourceKey = `subcontractor:${marker}:${subcontractorId}`
    await transform('subcontractor', sourceKey, {
      id: String(subcontractorId),
      name: `Sub ${marker}`,
      street: '4 Main St',
      city: 'Mississauga',
      province: 'ON',
      postalcode: 'L5B 1A1',
      cname: 'Sub Contact',
      cnumber: '555-0102',
      cemail1: 'sub@example.test',
      cemail2: 'sub2@example.test',
      cemail3: null,
      interior: '$1,234.50',
      exterior: '   ',
      other: null,
      stock_notification_alert_type: '2',
    })

    const [row] = await getDb()
      .select()
      .from(subcontractors)
      .where(eq(subcontractors.id, subcontractorId))
    expect(row?.rateInterior).toBe('1234.50')
    // Blank and absent money is NULL, never zero.
    expect(row?.rateExterior).toBeNull()
    expect(row?.rateOther).toBeNull()
    expect(row?.sageSubcontractorId).toBeNull()
    expect(row?.stockNotificationAlertType).toBe(2)
  })

  test('a subcontractor contact attaches to its vendor', async () => {
    const sourceKey = `subcontractor_contact_info:${marker}:1`
    await transform('subcontractor_contact_info', sourceKey, {
      id: '1',
      subid: String(subcontractorId),
      contact_name: 'After Hours',
      phone: '555-0199',
      phone_ext: '12',
    })

    const rows = await getDb()
      .select()
      .from(subcontractorContacts)
      .where(eq(subcontractorContacts.subcontractorId, subcontractorId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.phoneExt).toBe('12')
    expect((await crosswalkFor('subcontractor_contact', sourceKey))?.targetTable).toBe(
      'subcontractor_contacts',
    )
  })

  test('a contact with no vendor is an orphan line, not an invented parent', async () => {
    const sourceKey = `subcontractor_contact_info:${marker}:2`
    await transform('subcontractor_contact_info', sourceKey, {
      id: '2',
      subid: String(base + 901),
      contact_name: 'Ghost',
      phone: '555-0000',
      phone_ext: null,
    })

    expect(await exceptionFor('orphan_line', 'subcontractor_contact', sourceKey)).not.toBeNull()
    expect(await crosswalkFor('subcontractor_contact', sourceKey)).toBeNull()
    const rows = await getDb()
      .select()
      .from(subcontractorContacts)
      .where(eq(subcontractorContacts.subcontractorId, base + 901))
    expect(rows).toHaveLength(0)
  })

  test('supplier PO flags and notes are preserved', async () => {
    const sourceKey = `suppliers:${marker}:${supplierId}`
    await transform('suppliers', sourceKey, {
      id: String(supplierId),
      sage_vendor_id: String(base + 500),
      name: `Supplier ${marker}`,
      address: '5 Supply Rd',
      city: 'Brampton',
      province: 'ON',
      postalcode: 'L6T 1A1',
      additional_emails: 'ops@example.test',
      additional_emails_accounting: 'ar@example.test',
      contact_number: '555-0103',
      contact_person: 'Ava',
      user_id: null,
      is_under_cls: '1',
      is_online_vendor: '0',
      popnotes: 'Call before delivery',
      bypass_po_approval: '1',
    })

    const [row] = await getDb().select().from(suppliers).where(eq(suppliers.id, supplierId))
    expect(row?.sageVendorId).toBe(base + 500)
    expect(row?.poNotes).toBe('Call before delivery')
    expect(row?.isUnderCls).toBe(true)
    expect(row?.isOnlineVendor).toBe(false)
    expect(row?.bypassPoApproval).toBe(true)
    // The portal user is an app.users uuid and users are group 3.
    expect(row?.userId).toBeNull()
  })

  test('two suppliers claiming one Sage vendor id fail loudly', async () => {
    const sourceKey = `suppliers:${marker}:${rivalSupplierId}`
    await expect(
      transform('suppliers', sourceKey, {
        id: String(rivalSupplierId),
        sage_vendor_id: String(base + 500),
        name: `Rival ${marker}`,
      }),
    ).rejects.toThrow(/sage_vendor_id/)
  })

  test('customer e-mails are counted as not migrated and crosswalked to the mirror', async () => {
    const sourceKey = `customer_emails:${marker}:1`
    await transform('customer_emails', sourceKey, {
      id: '1',
      email: 'ar@example.test',
      name: 'Accounts Receivable',
    })

    const recorded = await exceptionFor('not_migrated', 'customer_email', 'customer_emails')
    expect(recorded?.migrationAction).toContain('no app table exists')
    expect(recorded?.notes).toContain('no customer key')
    const mapped = await crosswalkFor('customer_email', sourceKey)
    expect(mapped?.targetTable).toBe('public.customer_emails')
    expect(mapped?.targetKey).toBe(sourceKey)
  })

  test('an address-change row names its missing site and stays in the mirror', async () => {
    const sourceKey = `site_address_change_log:${marker}:1`
    await transform('site_address_change_log', sourceKey, {
      id: '1',
      site_id: String(missingSiteId),
      sage_address: 'Old address',
      portal_address: 'New address',
      keep_warranty: 'yes',
      log_date: '2026-02-01',
    })

    expect(await exceptionFor('orphan_line', 'site_address_change', sourceKey)).not.toBeNull()
    expect(
      await exceptionFor('not_migrated', 'site_address_change', 'site_address_change_log'),
    ).not.toBeNull()
    expect((await crosswalkFor('site_address_change', sourceKey))?.targetTable).toBe(
      'public.site_address_change_log',
    )
  })

  test('replaying a customer is an upsert, not a second row', async () => {
    const sourceKey = `customer:${marker}:${customerId}`
    await transform('customer', sourceKey, {
      id: String(customerId),
      name: `Customer ${marker} renamed`,
      city: 'Ottawa',
    })

    const rows = await getDb().select().from(customers).where(eq(customers.id, customerId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe(`Customer ${marker} renamed`)
    expect(rows[0]?.city).toBe('Ottawa')
  })

  test('the unmapped record covers the columns with no forward home', () => {
    expect(transformer.unmapped?.['suppliers.user_id']).toContain('identity')
    expect(transformer.unmapped?.['customer_emails.*']).toContain('mirror')
    expect(transformer.unmapped?.['site_address_change_log.*']).toContain('mirror')
  })
})
