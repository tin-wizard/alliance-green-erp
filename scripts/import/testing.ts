/**
 * Test seam for group transformers.
 *
 * A transformer is a function of one staged row and a transaction. That is all a
 * unit test needs: no dump, no loader, no checkpoints. The rehearsal exercises
 * the whole path; these tests pin the mapping rules row by row.
 */
import { clearExistsMemo } from './exists-memo'
import type { Tx } from '@cls/db'
import { getConfig } from '@cls/core/env.server'
import { createHelpers } from './helpers'
import type { GroupTransformer, TransformContext } from './types'

export interface TransformerRowInput {
  group: string
  table: string
  sourceKey?: string
  row: Record<string, string | null>
  dumpId?: string
}

export function contextFor(tx: Tx, input: TransformerRowInput): TransformContext {
  const context = {
    tx,
    dumpId: input.dumpId ?? 'test-dump',
    group: input.group,
    table: input.table,
    sourceKey: input.sourceKey ?? 'test-key',
    row: input.row,
  }
  return { ...context, helpers: createHelpers(context) }
}

export async function runTransformerRow(
  tx: Tx,
  transformer: GroupTransformer,
  input: TransformerRowInput,
): Promise<void> {
  // A test row must see the database as it is, never a previous test's memo.
  clearExistsMemo()
  await transformer.transform(contextFor(tx, input))
}

/** Matches the repository's integration tests: the same config, not raw env. */
export function databaseConfigured(): boolean {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
}
