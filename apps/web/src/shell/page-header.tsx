import type { ReactNode } from 'react'

/**
 * Page header: eyebrow, serif title, description, right-aligned actions.
 * Sizes and spacing follow the design spec's 88-120px header band.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-hair pb-6 pt-2 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-fg-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
