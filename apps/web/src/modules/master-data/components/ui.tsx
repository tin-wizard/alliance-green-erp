import type {
  ButtonHTMLAttributes,
  ComponentPropsWithRef,
  ReactNode,
} from 'react'
import { cn } from '@cls/ui'

/** Master Data primitives. Same tokens as the rest of the app; no new theme. */

const CONTROL =
  'w-full rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 text-[13px] text-fg placeholder:text-[var(--text-faint)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-[var(--surface-subtle)]'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
}) {
  const variants = {
    primary:
      'border-[var(--action-primary-bg)] bg-[var(--action-primary-bg)] text-[var(--action-primary-fg)] hover:bg-[var(--action-primary-bg-hover)]',
    secondary:
      'border-[var(--border-strong)] bg-[var(--surface-canvas)] text-fg hover:bg-[var(--surface-subtle)]',
    ghost: 'border-transparent bg-transparent text-fg hover:bg-[var(--surface-subtle)]',
  }
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[4px] border text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
        variants[variant],
        size === 'sm' ? 'h-8 px-2.5' : 'h-9 px-3.5',
        className,
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: ComponentPropsWithRef<'input'>) {
  return <input className={cn(CONTROL, 'h-9', className)} {...props} />
}

export function Select({ className, children, ...props }: ComponentPropsWithRef<'select'>) {
  return (
    <select className={cn(CONTROL, 'h-9 pr-8', className)} {...props}>
      {children}
    </select>
  )
}

export function Field({
  label,
  value,
  className,
}: {
  label: string
  value: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-fg">{value ?? '—'}</dd>
    </div>
  )
}

export function Card({
  title,
  action,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section className={cn('rounded-[6px] border border-hair bg-canvas', className)}>
      {title || action ? (
        <div className="flex items-center justify-between gap-3 border-b border-hair px-4 py-3">
          <h2 className="text-[14px] font-semibold text-fg">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'warning' | 'danger' | 'info'
}) {
  const tones = {
    neutral: 'border-hair text-fg-muted',
    warning:
      'border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]',
    danger:
      'border-[var(--status-rejected-bd)] bg-[var(--status-rejected-bg)] text-[var(--status-rejected-fg)]',
    info: 'border-[var(--status-approved-bd)] bg-[var(--status-approved-bg)] text-[var(--status-approved-fg)]',
  }
  return (
    <span
      className={cn(
        'inline-flex h-[20px] items-center gap-1 rounded-[2px] border px-1.5 text-[10.5px] font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
      <p className="font-serif text-[20px] text-fg">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[46ch] text-[13px] leading-relaxed text-fg-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function ErrorPanel({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="rounded-[6px] border border-[var(--status-rejected-bd)] bg-[var(--status-rejected-bg)] p-4 text-[13px] text-[var(--status-rejected-fg)]">
      <p className="font-medium">We couldn’t load this.</p>
      <p className="mt-1">{message}</p>
      {retry ? (
        <Button size="sm" className="mt-3" onClick={retry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}

export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return value
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
  }).format(number)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
