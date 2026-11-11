/**
 * Writes sample PDFs for visual review:
 *   /tmp/cls-pdf-quote-sample.pdf
 *   /tmp/cls-pdf-packing-sample.pdf
 *
 * Run from the repo root: pnpm exec tsx packages/pdf/scripts/render-sample.ts
 * (tsx is not currently a repo devDependency; any tsx/ts-node runner works.)
 */
import { writeFile } from 'node:fs/promises'
import { countPdfPages, renderDocument } from '../src/index'
import { packingSlipFixture, quoteFixture } from '../test/fixtures'

const QUOTE_PATH = '/tmp/cls-pdf-quote-sample.pdf'
const PACKING_SLIP_PATH = '/tmp/cls-pdf-packing-sample.pdf'

const quote = await renderDocument('quote', quoteFixture())
await writeFile(QUOTE_PATH, quote)
process.stdout.write(`${QUOTE_PATH} — ${quote.length} bytes, ${countPdfPages(quote)} page(s)\n`)

const packingSlip = await renderDocument('packing-slip', packingSlipFixture())
await writeFile(PACKING_SLIP_PATH, packingSlip)
process.stdout.write(
  `${PACKING_SLIP_PATH} — ${packingSlip.length} bytes, ${countPdfPages(packingSlip)} page(s)\n`,
)
