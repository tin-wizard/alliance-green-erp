import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  Select,
  Tag,
  Textarea,
  formatDateTime,
} from '../../../modules/work-orders/components/ui'
import { PageHeader } from '../../../shell/page-header'
import {
  DECISION_LABELS,
  FINDING_DECISIONS,
  type FindingDecision,
  type FindingView,
} from '../../../modules/sage/lib/decisions'
import {
  decideFindingFn,
  listReconciliationFn,
} from '../../../modules/sage/server/decisions.functions'
import {
  listSageOutboxFn,
  retrySagePostingFn,
} from '../../../modules/invoicing/server/invoicing.functions'

export const Route = createFileRoute('/_app/admin/reconciliation')({
  component: ReconciliationPage,
})

/**
 * Failed and dead-lettered outbox rows. A failed row retries on its own; a dead
 * letter never does, so it needs a person to look at the error and requeue it.
 */
function SageOutboxCard() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['sage', 'outbox'], queryFn: () => listSageOutboxFn() })
  const retry = useMutation({
    mutationFn: (postingId: number) => retrySagePostingFn({ data: { postingId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sage', 'outbox'] }),
  })

  return (
    <Card title="Sage outbox needing attention" padded={false}>
      {query.isPending ? (
        <p className="px-4 py-3 text-[12.5px] text-fg-muted">Loading outbox…</p>
      ) : query.isError ? (
        <p className="px-4 py-3 text-[12.5px] text-danger">
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </p>
      ) : query.data.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-fg-muted">
          Nothing stuck. The worker posts queued documents every tick.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]" data-testid="sage-outbox">
            <thead>
              <tr className="bg-subtle text-left text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                <th scope="col" className="px-4 py-2 font-semibold">Document</th>
                <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                <th scope="col" className="px-4 py-2 font-semibold">Attempts</th>
                <th scope="col" className="px-4 py-2 font-semibold">Last error</th>
                <th scope="col" className="px-4 py-2 font-semibold">Updated</th>
                <th scope="col" className="px-4 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {query.data.map((row) => (
                <tr key={row.id} className="border-t border-hair align-top">
                  <td className="px-4 py-2 text-fg-secondary">
                    {row.docType} #{row.docId}
                    <span className="block font-mono text-[10.5px] text-fg-muted">{row.externalRef}</span>
                  </td>
                  <td className="px-4 py-2">
                    <Tag tone={row.status === 'dead_letter' ? 'danger' : 'warning'}>{row.status}</Tag>
                  </td>
                  <td className="px-4 py-2 text-fg-muted">{row.attempt}</td>
                  <td className="max-w-[320px] px-4 py-2 text-fg-secondary">{row.lastError ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
                    {formatDateTime(row.updatedAt)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" onClick={() => retry.mutate(row.id)} disabled={retry.isPending}>
                      Requeue
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {retry.isError ? (
        <p className="px-4 py-2 text-[12px] text-danger">
          {retry.error instanceof Error ? retry.error.message : String(retry.error)}
        </p>
      ) : null}
    </Card>
  )
}

function severityTone(severity: string): 'danger' | 'warning' | 'info' {
  if (severity === 'blocker') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'info'
}

function money(value: string | null): string {
  if (value === null) return '—'
  return `$${value}`
}

function DecisionForm({ finding, onDone }: { finding: FindingView; onDone: () => void }) {
  const [decision, setDecision] = useState<FindingDecision>('accepted')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => decideFindingFn({ data: { findingId: finding.id, decision, note } }),
    onSuccess: () => {
      setNote('')
      setError(null)
      onDone()
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
  })

  return (
    <div className="space-y-2">
      <div className="grid gap-2 md:grid-cols-[200px_1fr_auto] md:items-end">
        <Field label="Decision">
          <Select
            value={decision}
            onChange={(event) => setDecision(event.target.value as FindingDecision)}
          >
            {FINDING_DECISIONS.map((value) => (
              <option key={value} value={value}>
                {DECISION_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reason (recorded in the audit log)">
          <Textarea
            rows={2}
            value={note}
            placeholder="Why this difference is acceptable, or who fixed it"
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Button
          size="sm"
          variant="primary"
          disabled={save.isPending || note.trim().length < 3}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Recording…' : 'Record decision'}
        </Button>
      </div>
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </div>
  )
}

function ReconciliationPage() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['sage', 'reconciliation'],
    queryFn: () => listReconciliationFn(),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sage', 'reconciliation'] })

  if (query.isPending) {
    return <p className="p-6 text-[13px] text-fg-muted">Loading reconciliation…</p>
  }
  if (query.isError) {
    return (
      <ErrorPanel message={query.error instanceof Error ? query.error.message : String(query.error)} />
    )
  }

  const { runs, open, decided, errors } = query.data
  const latest = runs[0]

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Sage reconciliation"
        description="Every daily run writes one row and one row per finding. A warning that goes undecided fails the next run, so a finding is an instruction, not a notification."
      />

      <SageOutboxCard />

      {errors.length > 0 ? (
        <Card title="Runs that could not compare anything">
          <ul className="space-y-1 text-[12.5px] text-fg-secondary">
            {errors.map((run) => (
              <li key={run.id}>
                <span className="font-mono text-[11px] text-fg-muted">#{run.id}</span>{' '}
                {formatDateTime(run.startedAt)} — {run.error ?? 'no reason recorded'}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title="Recent runs"
        action={
          latest ? (
            <Tag tone={latest.status === 'passed' ? 'info' : latest.status === 'error' ? 'danger' : 'warning'}>
              Latest: {latest.status}
            </Tag>
          ) : null
        }
        padded={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]" data-testid="reconciliation-runs">
            <thead>
              <tr className="bg-subtle text-left text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                <th scope="col" className="px-4 py-2 font-semibold">Run</th>
                <th scope="col" className="px-4 py-2 font-semibold">Mode</th>
                <th scope="col" className="px-4 py-2 font-semibold">Started</th>
                <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                <th scope="col" className="px-4 py-2 font-semibold">Findings</th>
                <th scope="col" className="px-4 py-2 font-semibold">Divergence</th>
                <th scope="col" className="px-4 py-2 font-semibold">Signed</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-fg-muted">
                    No run yet. The daily job runs at 06:00 America/Toronto, or trigger it with the job
                    runner.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.id} className="border-t border-hair align-top">
                    <td className="px-4 py-2 font-mono text-[11px] text-fg-secondary">#{run.id}</td>
                    <td className="px-4 py-2 text-fg-muted">
                      {run.mode}
                      {run.phase ? <span className="block text-[11px]">{run.phase}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
                      {formatDateTime(run.startedAt)}
                    </td>
                    <td className="px-4 py-2">
                      <Tag
                        tone={
                          run.status === 'passed'
                            ? 'info'
                            : run.status === 'error'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {run.status}
                      </Tag>
                    </td>
                    <td className="px-4 py-2 text-fg-secondary">
                      {run.findings} ({run.blockers}b / {run.warnings}w)
                    </td>
                    <td className="px-4 py-2 text-fg-secondary">{money(run.divergenceTotal)}</td>
                    <td className="px-4 py-2 text-fg-muted">
                      {run.signedAt ? formatDateTime(run.signedAt) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Open findings (${open.length})`}>
        {open.length === 0 ? (
          <EmptyState title="Nothing open" description="Every finding in the recent runs carries a decision." />
        ) : (
          <ul className="space-y-5">
            {open.map((finding) => (
              <li key={finding.id} className="rounded-md border border-hair p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Tag tone={severityTone(finding.severity)}>{finding.severity}</Tag>
                  <span className="font-mono text-[11.5px] text-fg">{finding.code}</span>
                  <span className="text-[11px] text-fg-muted">
                    run #{finding.runId} · owner {finding.owner}
                  </span>
                  {finding.externalRef ? (
                    <span className="font-mono text-[10.5px] text-fg-faint">{finding.externalRef}</span>
                  ) : null}
                  <span className="ml-auto text-[11.5px] text-fg-muted">
                    expected {money(finding.expected)} · actual {money(finding.actual)}
                  </span>
                </div>
                {finding.detail ? (
                  <pre className="mb-3 overflow-x-auto rounded bg-subtle p-2 text-[10.5px] text-fg-secondary">
                    {finding.detail}
                  </pre>
                ) : null}
                <DecisionForm finding={finding} onDone={refresh} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Recently decided (${decided.length})`}>
        {decided.length === 0 ? (
          <EmptyState title="No decisions yet" description="Recorded decisions appear here with their reason and author." />
        ) : (
          <ul className="space-y-2 text-[12.5px]">
            {decided.map((finding) => (
              <li key={finding.id} className="border-t border-hair pt-2 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone="info">{DECISION_LABELS[finding.decision as FindingDecision] ?? finding.decision}</Tag>
                  <span className="font-mono text-[11px] text-fg-secondary">{finding.code}</span>
                  <span className="text-[11px] text-fg-muted">
                    run #{finding.runId} · {finding.decidedAt ? formatDateTime(finding.decidedAt) : '—'}
                  </span>
                </div>
                <p className="mt-1 text-fg-secondary">{finding.decisionNote ?? '—'}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
