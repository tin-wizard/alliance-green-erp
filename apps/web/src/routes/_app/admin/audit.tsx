import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '../../../shell/page-header'

export const Route = createFileRoute('/_app/admin/audit')({
  component: AuditPage,
})

function AuditPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Audit log"
        description="Every write records an immutable row in audit_log: actor, action, entity, before and after values, request id, IP and user agent."
      />
      <div className="rounded-[6px] border border-hair bg-canvas p-6">
        <p className="text-[14px] font-medium text-fg">The log is being written; the viewer is not built.</p>
        <p className="mt-2 max-w-[68ch] text-[13px] leading-relaxed text-fg-secondary">
          Sign-in, sign-out and failed sign-in attempts are already recorded, alongside any module
          write that calls <code className="font-mono text-[12px]">writeAudit()</code> in its
          transaction. Query it directly for now:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-[4px] border border-hair bg-subtle p-3 font-mono text-[11.5px] leading-relaxed text-fg-secondary">
{`select created_at, action, actor_label, entity_type, entity_id, summary
from audit_log
order by created_at desc
limit 50;`}
        </pre>
      </div>
    </div>
  )
}
