import type { ReactNode } from 'react'
import { Card } from '../../work-orders/components/ui'

export function MasterPage({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            {eyebrow}
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">{title}</h1>
          <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-[4px] border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger" role="alert">
      {message}
    </p>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-1 py-6 text-center text-[13px] text-fg-muted">{children}</p>
}

export function MasterCard({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card title={title} action={action}>
      {children}
    </Card>
  )
}
