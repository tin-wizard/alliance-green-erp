import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../../shell/page-header'
import { Button, Card, ErrorPanel, Tag } from './ui'
import { runSageImportFn } from '../server/master-data.functions'
import type { ImportResult } from '../server/import.server'

/** Admin-only Sage reconciliation preview. Apply is never automatic. */
export function ImportPanel() {
  const [dryRun, setDryRun] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const preview = useMutation({
    mutationFn: () => runSageImportFn({ data: { apply: false } }),
    onSuccess: (result) => setDryRun(result),
  })
  const apply = useMutation({
    mutationFn: () => runSageImportFn({ data: { apply: true } }),
    onSuccess: (result) => setApplied(result),
  })
  const result = applied ?? dryRun
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Master Data · Reconciliation"
        title="Sage re-import."
        description="Compare the Sage mirror with the forward tables, review conflicts, then apply. Nothing is deleted, no id is renumbered, and local edits win over a seed field."
        actions={
          <div className="flex gap-2">
            <Button onClick={() => preview.mutate()} disabled={preview.isPending || apply.isPending}>
              {preview.isPending ? 'Checking…' : 'Dry run'}
            </Button>
            <Button
              variant="primary"
              onClick={() => apply.mutate()}
              disabled={!dryRun || apply.isPending}
            >
              {apply.isPending ? 'Applying…' : 'Apply reviewed changes'}
            </Button>
          </div>
        }
      />
      {preview.error ? <ErrorPanel message={(preview.error as Error).message} /> : null}
      {apply.error ? <ErrorPanel message={(apply.error as Error).message} /> : null}
      {applied ? <Tag tone="info">Applied. Re-running the same extract is a no-op.</Tag> : null}
      {result ? (
        <>
          <Card title={`${result.applied ? 'Applied' : 'Dry run'} summary`} padded={false}>
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-hair bg-[var(--surface-subtle)]">
                  {['Entity', 'Source', 'Create', 'Link', 'Update', 'Unchanged', 'Conflicts', 'Missing'].map((header) => (
                    <th key={header} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.summaries.map((summary) => (
                  <tr key={summary.entity} className="border-b border-hair last:border-0">
                    <td className="px-4 py-2.5 capitalize">{summary.entity}</td>
                    <td className="px-4 py-2.5">{summary.source}</td>
                    <td className="px-4 py-2.5">{summary.create}</td>
                    <td className="px-4 py-2.5">{summary.link}</td>
                    <td className="px-4 py-2.5">{summary.update}</td>
                    <td className="px-4 py-2.5">{summary.unchanged}</td>
                    <td className="px-4 py-2.5">{summary.conflicts > 0 ? <Tag tone="warning">{summary.conflicts}</Tag> : 0}</td>
                    <td className="px-4 py-2.5">{summary.missing > 0 ? <Tag tone="danger">{summary.missing}</Tag> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Conflicts" padded={false}>
              {result.conflicts.length === 0 ? (
                <p className="p-4 text-[13px] text-fg-muted">No field conflicts.</p>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead><tr className="border-b border-hair bg-[var(--surface-subtle)]"><th className="px-4 py-2 text-[10.5px] uppercase tracking-[0.1em] text-fg-muted">Entity</th><th className="px-4 py-2 text-[10.5px] uppercase tracking-[0.1em] text-fg-muted">Local</th><th className="px-4 py-2 text-[10.5px] uppercase tracking-[0.1em] text-fg-muted">Field</th></tr></thead>
                  <tbody>{result.conflicts.slice(0, 100).map((conflict) => <tr key={`${conflict.entity}-${conflict.localId}-${conflict.field}`} className="border-b border-hair last:border-0"><td className="px-4 py-2 capitalize">{conflict.entity}</td><td className="px-4 py-2">{conflict.localId}</td><td className="px-4 py-2">{conflict.field}</td></tr>)}</tbody>
                </table>
              )}
            </Card>
            <Card title="Missing from Sage" padded={false}>
              {result.missing.length === 0 ? (
                <p className="p-4 text-[13px] text-fg-muted">No linked rows missing from this extract.</p>
              ) : (
                <p className="p-4 text-[13px] text-fg-muted">{result.missing.length} linked rows were not in the source. They were kept, not deleted.</p>
              )}
            </Card>
          </div>
        </>
      ) : (
        <Card title="Nothing loaded">Run a dry run to see the diff. Apply stays disabled until a dry run completes.</Card>
      )}
    </div>
  )
}
