import { STATUS_LABELS, type Status } from '@cls/core'

/**
 * Status chip driven by the token triples, so a theme change recolours every
 * chip without touching this component. No dynamic Tailwind class names.
 */
export function StatusChip({ status }: { status: Status }) {
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1.5 rounded-[2px] border px-[7px] text-[10.5px] font-semibold tracking-[0.02em]"
      style={{
        color: `var(--status-${status}-fg)`,
        backgroundColor: `var(--status-${status}-bg)`,
        borderColor: `var(--status-${status}-bd)`,
      }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `var(--status-${status}-fg)` }}
      />
      {STATUS_LABELS[status]}
    </span>
  )
}
