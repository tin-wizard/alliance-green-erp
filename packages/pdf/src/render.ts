/**
 * `renderDocument(kind, data)` — the one entry point modules call.
 *
 * Validates the DTO, applies deterministic PDF metadata, renders the registered
 * component inside the shared shell and returns a Node `Buffer`. Concurrency is
 * capped in-process so a large document cannot starve the LAN host.
 */
import { createElement, type ComponentType } from 'react'
import { Document, renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { assertFontsPresent } from './fonts'
import { PDF_REGISTRY, type PdfDocumentDefinition } from './registry'
import {
  PDF_RENDERER_VERSION,
  type DocumentData,
  type DocumentDataFor,
  type DocumentKind,
} from './types'

/** In-process render cap (ADR 0011: initially 2). */
export const PDF_RENDER_CONCURRENCY = 2

export class PdfRenderError extends Error {
  readonly code = 'pdf_render_failed'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PdfRenderError'
  }
}

/**
 * Small FIFO semaphore. A released slot is handed directly to the next waiter,
 * so `active` never exceeds the cap.
 */
class Semaphore {
  readonly #limit: number
  readonly #waiters: Array<() => void> = []
  #active = 0

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('Semaphore limit must be a positive integer')
    }
    this.#limit = limit
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.#acquire()
    try {
      return await task()
    } finally {
      this.#release()
    }
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.#limit) {
      this.#active += 1
      return
    }
    await new Promise<void>((resolve) => {
      this.#waiters.push(resolve)
    })
  }

  #release(): void {
    const next = this.#waiters.shift()
    if (next) {
      next()
      return
    }
    this.#active -= 1
  }
}

const RENDER_SEMAPHORE = new Semaphore(PDF_RENDER_CONCURRENCY)

/**
 * Renders `data` for `kind` to a PDF buffer.
 *
 * @throws PdfFontError when a vendored font face is missing
 * @throws ZodError when the DTO does not match the kind's schema
 * @throws PdfRenderError when the layout itself fails
 */
export async function renderDocument<TKind extends DocumentKind>(
  kind: TKind,
  data: DocumentDataFor<TKind>,
): Promise<Buffer> {
  const definition = PDF_REGISTRY[kind] as PdfDocumentDefinition | undefined
  if (!definition) {
    throw new PdfRenderError(
      `Unknown document kind "${String(kind)}". Registered kinds: ${Object.keys(PDF_REGISTRY).join(', ')}.`,
    )
  }

  // Checked per render as well as at module load, so a font removed from a
  // deployed host fails with a clear message instead of a fontkit stack.
  assertFontsPresent()

  const parsed = definition.schema.parse(data) as DocumentData
  const element = createElement(
    Document,
    buildMetadata(definition, parsed),
    createElement(definition.component as ComponentType<{ data: DocumentData }>, {
      data: parsed,
    }),
  )

  return RENDER_SEMAPHORE.run(async () => {
    try {
      return await renderToBuffer(element)
    } catch (error) {
      throw new PdfRenderError(
        `Failed to render ${definition.kind} ${documentLabel(parsed)}.`,
        { cause: error },
      )
    }
  })
}

function documentLabel(data: DocumentData): string {
  if ('number' in data) return data.number
  if ('title' in data) return data.title
  return 'document'
}

function documentDate(data: DocumentData): string {
  if ('issuedOn' in data) return data.issuedOn
  if ('generatedOn' in data) return data.generatedOn
  return '1970-01-01'
}

/**
 * PDF metadata required by the ADR. Dates are derived from the DTO's `issuedOn`
 * (or a report's `generatedOn`) rather than the wall clock so two renders of one
 * snapshot are byte-identical.
 */
function buildMetadata(definition: PdfDocumentDefinition, data: DocumentData): DocumentProps {
  const timestamp = new Date(`${documentDate(data)}T12:00:00.000Z`)
  const label = documentLabel(data)
  return {
    title: `${definition.title} ${label}`,
    author: 'Alliance Lighting',
    subject: `${definition.kind} ${label}`,
    creator: 'CLS Green ERP',
    producer: `@cls/pdf ${PDF_RENDERER_VERSION}`,
    language: 'en-CA',
    creationDate: timestamp,
    modificationDate: timestamp,
  }
}

const PAGE_OBJECT = /\/Type\s*\/Page\b/g

/** Counts page objects in the rendered bytes. */
export function countPdfPages(buffer: Buffer | Uint8Array): number {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const matches = bytes.toString('latin1').match(PAGE_OBJECT)
  return matches ? matches.length : 0
}
