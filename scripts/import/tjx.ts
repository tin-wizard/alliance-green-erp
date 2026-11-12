/**
 * TJX historical import.
 *
 * Reads the `public.tjx_*` mirror only, never the app tables as a source.
 * `--dry-run` is the default recommendation: it reports what is recoverable and
 * what is missing without writing. The archive has no quote headers, so the
 * normal dry run reports quote history as unrecoverable rather than inventing
 * parents.
 *
 * Usage:
 *   pnpm tsx scripts/import/tjx.ts --dry-run
 *   pnpm tsx scripts/import/tjx.ts --replace
 */
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@cls/db'
import { getConfig } from '@cls/core/env.server'
import {
  sites,
  legacyTjxFixture,
  legacyTjxFixtureParts,
  legacyTjxPricesPerQuote,
  legacyTjxQuote,
  legacyTjxQuoteExtraWorkorders,
  legacyTjxQuoteFixtures,
  legacyTjxQuoteParts,
  legacyTjxQuoteRevisions,
  legacyTjxQuoteSoparts,
  legacyTjxRoom,
  legacyTjxRoomsTemplate,
  legacyTjxSubcontractorRates,
  tjxFixtureParts,
  tjxFixtures,
  tjxQuoteFixtures,
  tjxQuoteParts,
  tjxQuotePrices,
  tjxQuoteRevisions,
  tjxQuoteRooms,
  tjxQuoteSpecialParts,
  tjxQuoteWorkOrders,
  tjxQuotes,
  tjxRoomTemplateRooms,
  tjxRoomTemplates,
  tjxRooms,
  tjxSubcontractorRates,
  workOrders,
} from '@cls/db/schema'
import { parsePhpSerialized } from '../../apps/web/src/modules/tjx/import/php-serialized'

interface Options {
  dryRun: boolean
  limit: number | null
  batch: number
  replace: boolean
}

interface Report {
  dryRun: boolean
  counts: Record<string, number>
  imported: Record<string, number>
  skipped: Record<string, number>
  missing: string[]
  revisionFailures: number[]
  warnings: string[]
}

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, limit: null, batch: 500, replace: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--dry-run') options.dryRun = true
    else if (value === '--replace') options.replace = true
    else if (value === '--limit') options.limit = Number(argv[++index])
    else if (value === '--batch') options.batch = Number(argv[++index])
  }
  if (!Number.isFinite(options.batch) || options.batch < 1) options.batch = 500
  if (options.limit !== null && (!Number.isFinite(options.limit) || options.limit < 1)) {
    options.limit = null
  }
  return options
}

function num(value: string | null | undefined): string | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? String(parsed) : null
}

function date(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!getConfig().databaseUrl) throw new Error('DATABASE_URL is required.')
  const db = getDb()
  const report: Report = {
    dryRun: options.dryRun,
    counts: {},
    imported: {},
    skipped: {},
    missing: [],
    revisionFailures: [],
    warnings: [],
  }

  const counts = {
    rooms: (await db.select({ n: sql<number>`count(*)::int` }).from(legacyTjxRoom))[0]!.n,
    fixtures: (await db.select({ n: sql<number>`count(*)::int` }).from(legacyTjxFixture))[0]!.n,
    fixtureParts: (await db.select({ n: sql<number>`count(*)::int` }).from(legacyTjxFixtureParts))[0]!.n,
    rates: (await db.select({ n: sql<number>`count(*)::int` }).from(legacyTjxSubcontractorRates))[0]!.n,
    quotes: (await db.select({ n: sql<number>`count(*)::int` }).from(legacyTjxQuote))[0]!.n,
    quoteFixtures: (await db.select({ n: sql<number>`count(*)::int` }).from(legacyTjxQuoteFixtures))[0]!.n,
    quoteParts: (await db.select({ n: sql<number>`count(*)::int` }).from(legacyTjxQuoteParts))[0]!.n,
    quoteSpecials: (await db.select({ n: sql<number>`count(*)::int` }).from(legacyTjxQuoteSoparts))[0]!.n,
    revisions: (await db.select({ n: sql<number>`count(*)::int` }).from(legacyTjxQuoteRevisions))[0]!.n,
  }
  report.counts = counts

  if (counts.quotes === 0) {
    report.missing.push(
      'No legacy quote headers are present. Quote, fixture, part and revision history is unrecoverable without a live mysqldump; nothing was synthesized.',
    )
  }

  if (!options.dryRun) {
    const rooms = await db.select().from(legacyTjxRoom)
    for (const room of rooms) {
      if (!room.roomname?.trim()) {
        report.warnings.push(`Room ${room.id} has no name; skipped.`)
        continue
      }
      const [existing] = await db
        .select({ id: tjxRooms.id })
        .from(tjxRooms)
        .where(eq(tjxRooms.legacyId, room.id))
      if (existing) {
        bump(report.skipped, 'rooms')
        continue
      }
      await db
        .insert(tjxRooms)
        .values({
          legacyId: room.id,
          name: room.roomname.trim(),
          sortOrder: room.sortorder ?? 0,
        })
        .onConflictDoNothing()
      bump(report.imported, 'rooms')
    }

    const fixtures = await db.select().from(legacyTjxFixture)
    for (const fixture of fixtures) {
      if (!fixture.fixturename?.trim()) continue
      const [existing] = await db
        .select({ id: tjxFixtures.id })
        .from(tjxFixtures)
        .where(eq(tjxFixtures.legacyId, fixture.id))
      if (existing) {
        bump(report.skipped, 'fixtures')
        continue
      }
      await db
        .insert(tjxFixtures)
        .values({
          legacyId: fixture.id,
          name: fixture.fixturename.trim(),
          sortOrder: fixture.sortorder ?? 0,
        })
        .onConflictDoNothing()
      bump(report.imported, 'fixtures')
    }

    const fixtureRows = await db.select().from(legacyTjxFixtureParts)
    for (const part of fixtureRows) {
      const [fixture] = await db
        .select({ id: tjxFixtures.id })
        .from(tjxFixtures)
        .where(eq(tjxFixtures.legacyId, part.fixtureid ?? -1))
      if (!fixture || !part.partno) {
        report.warnings.push(`Fixture part ${part.id} has no parent fixture; skipped.`)
        continue
      }
      await db
        .insert(tjxFixtureParts)
        .values({
          fixtureId: fixture.id,
          partNo: part.partno.trim().toUpperCase(),
          partType: part.parttype ?? '',
          markup: num(part.markup) ?? '1',
          ratioPerFixture: num(part.partRatioPerfixture) ?? '0',
        })
        .onConflictDoNothing()
      bump(report.imported, 'fixtureParts')
    }

    const rates = await db.select().from(legacyTjxSubcontractorRates)
    for (const rate of rates) {
      await db
        .insert(tjxSubcontractorRates)
        .values({
          legacyId: rate.id,
          subcontractorId: rate.subid,
          partNo: rate.partno.trim().toUpperCase(),
          installCostPerUnit: num(rate.installcostperunit) ?? '0',
        })
        .onConflictDoNothing()
      bump(report.imported, 'rates')
    }

    const templateRooms = await db.select().from(legacyTjxRoomsTemplate)
    if (templateRooms.length > 0) {
      let [template] = await db
        .select()
        .from(tjxRoomTemplates)
        .where(eq(tjxRoomTemplates.isDefault, true))
      if (!template) {
        ;[template] = await db
          .insert(tjxRoomTemplates)
          .values({ name: 'Default Room Template', isDefault: true })
          .returning()
      }
      for (const [index, row] of templateRooms.entries()) {
        const [room] = await db
          .select({ id: tjxRooms.id })
          .from(tjxRooms)
          .where(eq(tjxRooms.legacyId, row.roomid ?? -1))
        if (!room || !template) continue
        await db
          .insert(tjxRoomTemplateRooms)
          .values({ templateId: template.id, roomId: room.id, sortOrder: row.sortorder ?? index })
          .onConflictDoNothing()
      }
      bump(report.imported, 'templateRooms')
    }
  }

  const quoteRows = await db
    .select()
    .from(legacyTjxQuote)
    .limit(options.limit ?? 100_000)
  for (const [index, quote] of quoteRows.entries()) {
    const legacyId = quote.id
    const [existing] = await db
      .select({ id: tjxQuotes.id })
      .from(tjxQuotes)
      .where(eq(tjxQuotes.legacyId, legacyId))
    if (existing && !options.replace) {
      bump(report.skipped, 'quotes')
      continue
    }
    if (options.dryRun) {
      bump(report.imported, 'quotes')
      continue
    }
    if (existing && options.replace) {
      await db.delete(tjxQuotes).where(eq(tjxQuotes.id, existing.id))
    }

    let siteId: number | null = null
    if (quote.site) {
      const [site] = await db
        .select({ id: sites.id })
        .from(sites)
        .where(eq(sites.id, quote.site))
        .limit(1)
      if (site) siteId = site.id
      else report.missing.push(`Quote ${legacyId}: site ${quote.site} was not found.`)
    }

    const [inserted] = await db
      .insert(tjxQuotes)
      .values({
        legacyId,
        siteId,
        status: quote.status ?? 1,
        quoteType: quote.quoteType ?? 'Gen 1',
        ceilingGridType: quote.ceilingGridType,
        isTypeMaintenance: Boolean(quote.isTypeMaintenance),
        paymentTermsCode: quote.paymentTerms,
        dueDate: date(quote.dueDate),
        shipToType: quote.shipToType,
        shipContactName: quote.shipAddressContactname,
        shipCompany: quote.shipAddressCompany,
        shipStreet1: quote.shipAddressStreet1,
        shipStreet2: quote.shipAddressStreet2,
        shipCity: quote.shipAddressCity,
        shipProvince: quote.shipAddressProvince,
        shipPostalCode: quote.shipAddressPostalcode,
        shipPhone: quote.shipAddressPhone,
        shippingAddress: quote.shippingAddress,
        taxCode: quote.taxCode,
        appliedTaxRate: quote.appliedtaxrate,
        subtotalAmount: num(quote.subtotalAmount) ?? '0',
        taxAmount: num(quote.taxAmount) ?? '0',
        totalAmount: num(quote.totalAmount) ?? '0',
        withoutMarkupSubtotalAmount: num(quote.withoutmarkupSubtotalAmount) ?? '0',
        withoutMarkupTaxAmount: num(quote.withoutmarkupTaxAmount) ?? '0',
        withoutMarkupTotalAmount: num(quote.withoutmarkupTotalAmount) ?? '0',
        notes: quote.notes,
        pdfNotes: quote.pdfNotes,
        revisionNotes: quote.revisionNotes,
        revisionNo: quote.revisionNo ?? 0,
        submittedAt: quote.isSubmitted ? new Date(quote.dateCreated ?? Date.now()) : null,
        importedAt: new Date(),
        createdAt: quote.dateCreated ? new Date(quote.dateCreated) : undefined,
      })
      .returning()
    if (!inserted) continue
    bump(report.imported, 'quotes')

    const roomRows = await db
      .select()
      .from(legacyTjxQuoteFixtures)
      .where(eq(legacyTjxQuoteFixtures.quoteid, legacyId))
      .orderBy(legacyTjxQuoteFixtures.sortorder)
    const roomMap = new Map<number, number>()
    for (const [roomIndex, row] of roomRows.entries()) {
      if (!row.roomid) continue
      let quoteRoomId = roomMap.get(row.roomid)
      if (!quoteRoomId) {
        const [appRoom] = await db
          .select({ id: tjxRooms.id, name: tjxRooms.name })
          .from(tjxRooms)
          .where(eq(tjxRooms.legacyId, row.roomid))
        const [created] = await db
          .insert(tjxQuoteRooms)
          .values({
            quoteId: inserted.id,
            roomId: appRoom?.id ?? null,
            roomName: appRoom?.name ?? `Room ${row.roomid}`,
            sortOrder: roomMap.size,
          })
          .returning()
        quoteRoomId = created!.id
        roomMap.set(row.roomid, quoteRoomId)
      }
      const [fixture] = await db
        .select({ id: tjxFixtures.id, name: tjxFixtures.name })
        .from(tjxFixtures)
        .where(eq(tjxFixtures.legacyId, row.fixtureid ?? -1))
      await db
        .insert(tjxQuoteFixtures)
        .values({
          quoteId: inserted.id,
          quoteRoomId,
          fixtureId: fixture?.id ?? null,
          fixtureName: fixture?.name ?? `Fixture ${row.fixtureid ?? roomIndex}`,
          quantity: num(row.totalfixtures) ?? '0',
          sortOrder: row.sortorder ?? roomIndex,
        })
        .onConflictDoNothing()
    }

    const partRows = await db
      .select()
      .from(legacyTjxQuoteParts)
      .where(eq(legacyTjxQuoteParts.quoteid, legacyId))
    for (const part of partRows) {
      await db
        .insert(tjxQuoteParts)
        .values({
          quoteId: inserted.id,
          partNo: part.partno.trim().toUpperCase(),
          qtyWithMarkup: String(part.qty),
          qtyWithoutMarkup: String(part.withoutMarkupQty ?? part.qty),
          unitPrice: num(String(part.price)) ?? '0',
          lineSubtotal: String((part.qty * Number(part.price ?? 0)).toFixed(2)),
          lineSubtotalWithoutMarkup: String(
            ((part.withoutMarkupQty ?? part.qty) * Number(part.price ?? 0)).toFixed(2),
          ),
          sortOrder: part.sortorder ?? 0,
          origin: 'legacy',
        })
        .onConflictDoNothing()
    }

    const specials = await db
      .select()
      .from(legacyTjxQuoteSoparts)
      .where(eq(legacyTjxQuoteSoparts.quoteid, legacyId))
    for (const special of specials) {
      if (!special.name) continue
      await db.insert(tjxQuoteSpecialParts).values({
        quoteId: inserted.id,
        name: special.name,
        quantity: String(special.qty ?? 0),
        unitPrice: num(String(special.price)) ?? '0',
        lineSubtotal: String(((special.qty ?? 0) * Number(special.price ?? 0)).toFixed(2)),
        sortOrder: special.sortorder ?? 0,
      })
    }

    const prices = await db
      .select()
      .from(legacyTjxPricesPerQuote)
      .where(eq(legacyTjxPricesPerQuote.quoteid, legacyId))
    for (const price of prices) {
      await db
        .insert(tjxQuotePrices)
        .values({
          quoteId: inserted.id,
          partNo: price.partno.trim().toUpperCase(),
          price: num(price.price) ?? '0',
          previousPrice: num(price.lastPrice),
          source: 'imported',
        })
        .onConflictDoNothing()
    }

    const revisions = await db
      .select()
      .from(legacyTjxQuoteRevisions)
      .where(eq(legacyTjxQuoteRevisions.quoteid, legacyId))
    for (const revision of revisions) {
      const snapshotObject = (text: string | null): Record<string, unknown> => {
        if (!text) return {}
        try {
          const parsed = parsePhpSerialized(text)
          return Array.isArray(parsed) ? { values: parsed } : (parsed as Record<string, unknown>)
        } catch {
          report.revisionFailures.push(revision.revisionId)
          return { _raw: text }
        }
      }
      const snapshotList = (text: string | null): Record<string, unknown>[] => {
        if (!text) return []
        try {
          const parsed = parsePhpSerialized(text)
          return Array.isArray(parsed)
            ? (parsed as Record<string, unknown>[])
            : [parsed as Record<string, unknown>]
        } catch {
          report.revisionFailures.push(revision.revisionId)
          return [{ _raw: text }]
        }
      }
      await db.insert(tjxQuoteRevisions).values({
        quoteId: inserted.id,
        revisionNo: 0,
        saveSeq: revision.revisionId,
        revisionType:
          revision.revisionType === 'insert' ||
          revision.revisionType === 'update' ||
          revision.revisionType === 'submit' ||
          revision.revisionType === 'approve' ||
          revision.revisionType === 'cancel' ||
          revision.revisionType === 'refresh_prices' ||
          revision.revisionType === 'email' ||
          revision.revisionType === 'import'
            ? revision.revisionType
            : 'import',
        notes: null,
        dataQuote: snapshotObject(revision.dataQuote),
        dataRooms: snapshotList(revision.dataFixtures),
        dataFixtures: snapshotList(revision.dataFixtures),
        dataParts: snapshotList(revision.dataParts),
        dataSpecialParts: snapshotList(revision.dataSoparts),
        createdAt: revision.createdTime ? new Date(revision.createdTime) : undefined,
      })
    }

    if (quote.workordernumber) {
      const workOrderId = Number(quote.workordernumber)
      const [workOrder] = await db
        .select({ id: workOrders.id })
        .from(workOrders)
        .where(eq(workOrders.id, workOrderId))
      if (workOrder) {
        await db
          .insert(tjxQuoteWorkOrders)
          .values({ quoteId: inserted.id, workOrderId, isPrimary: true, sortOrder: 0 })
          .onConflictDoNothing()
      } else {
        report.missing.push(`Quote ${legacyId}: work order ${quote.workordernumber} was not found.`)
      }
    }
    const extras = await db
      .select()
      .from(legacyTjxQuoteExtraWorkorders)
      .where(eq(legacyTjxQuoteExtraWorkorders.quoteid, legacyId))
    for (const extra of extras) {
      if (!extra.woid) continue
      const [workOrder] = await db
        .select({ id: workOrders.id })
        .from(workOrders)
        .where(eq(workOrders.id, extra.woid))
      if (!workOrder) {
        report.missing.push(`Quote ${legacyId}: extra work order ${extra.woid} was not found.`)
        continue
      }
      await db
        .insert(tjxQuoteWorkOrders)
        .values({
          quoteId: inserted.id,
          workOrderId: workOrder.id,
          isPrimary: false,
          sortOrder: extra.sortorder ?? 0,
        })
        .onConflictDoNothing()
    }

    if ((index + 1) % options.batch === 0) {
      report.warnings.push(`Imported ${index + 1} quotes.`)
    }
  }

  if (!options.dryRun) {
    for (const table of ['tjx_quotes', 'tjx_quote_rooms', 'tjx_quote_fixtures', 'tjx_quote_parts']) {
      await db.execute(
        sql.raw(
          `select setval(pg_get_serial_sequence('app.${table}', 'id'), coalesce((select max(id) from app.${table}), 1), (select max(id) is not null from app.${table}))`,
        ),
      )
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

await main()
