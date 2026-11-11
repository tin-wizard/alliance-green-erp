import type {
  ButtonHTMLAttributes,
  ComponentPropsWithRef,
  ReactNode,
} from 'react'
import { cn } from '@cls/ui'

/** Small primitives shared by the module's screens. Tailwind + semantic tokens only. */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[4px] border text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border-[var(--action-primary-bg)] bg-[var(--action-primary-bg)] text-[var(--action-primary-fg)] hover:bg-[var(--action-primary-bg-hover)]',
  secondary:
    'border-[var(--border-strong)] bg-[var(--surface-canvas)] text-fg hover:bg-[var(--surface-subtle)]',
  ghost: 'border-transparent bg-transparent text-fg hover:bg-[var(--surface-subtle)]',
  danger:
    'border-[var(--action-danger-bg)] bg-[var(--action-danger-bg)] text-[var(--action-danger-fg)] hover:bg-[var(--action-danger-bg-hover)]',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5',
  md: 'h-9 px-3.5',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  return (
    <button
      type={type}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  )
}

const CONTROL =
  'w-full rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 text-[13px] text-fg placeholder:text-[var(--text-faint)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-[var(--surface-subtle)]'

export function Input({ className, ...props }: ComponentPropsWithRef<'input'>) {
  return <input className={cn(CONTROL, 'h-9', className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentPropsWithRef<'textarea'>) {
  return <textarea className={cn(CONTROL, 'min-h-[80px] py-2 leading-relaxed', className)} {...props} />
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
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11.5px] text-danger" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[11.5px] text-fg-muted">{hint}</span>
      ) : null}
    </label>
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
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'warning' | 'danger' | 'info'
  className?: string
}) {
  const tones: Record<string, string> = {
    neutral: 'border-hair text-fg-muted',
    warning: 'border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]',
    danger: 'border-[var(--status-rejected-bd)] bg-[var(--status-rejected-bg)] text-[var(--status-rejected-fg)]',
    info: 'border-[var(--status-approved-bd)] bg-[var(--status-approved-bg)] text-[var(--status-approved-fg)]',
  }
  return (
    <span
      className={cn(
        'inline-flex h-[20px] items-center gap-1 rounded-[2px] border px-1.5 text-[10.5px] font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function TriageMarks({ flags }: { flags: readonly string[] }) {
  if (flags.length === 0) return <span className="text-fg-faint">—</span>
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Triage: ${flags.join(', ')}`}>
      {flags.includes('red') ? (
        <span title="Marked red" className="h-1.5 w-1.5 rounded-full bg-[var(--status-rejected-fg)]" />
      ) : null}
      {flags.includes('critical') ? (
        <span title="Critical" className="h-1.5 w-1.5 rounded-full bg-[var(--status-pending-fg)]" />
      ) : null}
      {flags.includes('green') ? (
        <span title="Marked green" className="h-1.5 w-1.5 rounded-full bg-[var(--status-complete-fg)]" />
      ) : null}
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
    <div className="flex min-h-[240px] flex-col items-center justify-center px-6 py-10 text-center">
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
  if (!value) return '—'
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
