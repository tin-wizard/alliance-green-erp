/**
 * `@cls/notifications` — outbox queueing, transport and retry policy (ADR 0013).
 *
 * No module builds SMTP options or sends inside a request. A sender calls
 * `queueNotification`; `platform.notifications-drain` is the only caller of a
 * transport. Tests use the memory transport and never touch the network.
 */
import type { Tx } from '@cls/db'
import type { Db } from '@cls/db'
import { notifications } from '@cls/db/schema'

export type Executor = Db | Tx

export type NotificationKind =
  | 'dispatch'
  | 'po-followup'
  | 'rga'
  | 'quote'
  | 'dunning'
  | 'compliance'
  | 'supplier'
  | 'system'

export interface QueueNotificationInput {
  kind: NotificationKind
  templateKey: string
  templateVersion?: number
  entityType?: string | null
  entityId?: string | null
  recipientUserId?: string | null
  recipientEmail?: string | null
  recipientName?: string | null
  subject: string
  bodyText: string
  bodyHtml?: string | null
  payload?: Record<string, unknown> | null
  dedupeKey?: string | null
  legacyRef?: string | null
  createdBy?: string | null
  /** Defaults to queued; a missing recipient records a skipped row. */
  status?: 'queued' | 'skipped' | 'suppressed'
  nextAttemptAt?: Date
}

/**
 * Queue one rendered message. `dedupeKey` is unique when present, so a retried
 * trigger writes one row and the first caller wins. Returns the new id, or null
 * when a duplicate was ignored.
 */
export async function queueNotification(
  executor: Executor,
  input: QueueNotificationInput,
): Promise<string | null> {
  const recipientMissing = !input.recipientEmail && !input.recipientUserId
  const status = input.status ?? (recipientMissing ? 'skipped' : 'queued')
  const [row] = await executor
    .insert(notifications)
    .values({
      kind: input.kind,
      templateKey: input.templateKey,
      templateVersion: input.templateVersion ?? 1,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      recipientUserId: input.recipientUserId ?? null,
      recipientEmail: input.recipientEmail ?? null,
      recipientName: input.recipientName ?? null,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml ?? null,
      payload: input.payload ?? null,
      dedupeKey: input.dedupeKey ?? null,
      status,
      nextAttemptAt: input.nextAttemptAt ?? new Date(),
      legacyRef: input.legacyRef ?? null,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id })
  return row?.id ?? null
}

export interface TransportMessage {
  to: string
  subject: string
  text: string
  html?: string | null
  from: string
  replyTo?: string | null
}

export interface TransportResult {
  providerMessageId: string | null
}

export interface NotificationTransport {
  readonly name: string
  send(message: TransportMessage): Promise<TransportResult>
}

export class MemoryTransport implements NotificationTransport {
  readonly name = 'memory'
  readonly sent: TransportMessage[] = []

  async send(message: TransportMessage): Promise<TransportResult> {
    this.sent.push(message)
    return { providerMessageId: `memory-${this.sent.length}` }
  }
}

export interface TransportConfig {
  kind: 'memory' | 'file' | 'smtp'
  from: string
  replyTo?: string | null
  overrideTo?: string | null
  directory?: string
}

function override(message: TransportMessage, config: TransportConfig): TransportMessage {
  if (!config.overrideTo) return message
  return {
    ...message,
    to: config.overrideTo,
    text: `[MAIL_OVERRIDE_TO: intended for ${message.to}]\n\n${message.text}`,
  }
}

/**
 * File transport for local development. It writes `.eml` files under
 * `var/mail`; it never opens a socket and never claims delivery.
 */
export class FileTransport implements NotificationTransport {
  readonly name = 'file'
  private sequence = 0

  constructor(
    private readonly config: TransportConfig,
    private readonly writeFile: (path: string, contents: string) => Promise<void>,
  ) {}

  async send(raw: TransportMessage): Promise<TransportResult> {
    const message = override(raw, this.config)
    this.sequence += 1
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
    const path = `${this.config.directory ?? 'var/mail'}/${stamp}-${this.sequence}.eml`
    await this.writeFile(path, toEml(message, this.config))
    return { providerMessageId: `file:${path}` }
  }
}

/** SMTP is deliberately unconfigured until the provider decision is made. */
export class UnconfiguredSmtpTransport implements NotificationTransport {
  readonly name = 'smtp'

  async send(): Promise<TransportResult> {
    throw new NotificationTransportError(
      'smtp_not_configured',
      'SMTP transport is selected but no provider adapter is installed.',
      true,
    )
  }
}

export class NotificationTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly permanent: boolean,
  ) {
    super(message)
    this.name = 'NotificationTransportError'
  }
}

export function transportFromConfig(config: TransportConfig): NotificationTransport {
  if (config.kind === 'memory') return new MemoryTransport()
  if (config.kind === 'file') {
    return new FileTransport(config, async (path, contents) => {
      const { mkdir, writeFile } = await import('node:fs/promises')
      const { dirname } = await import('node:path')
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, contents, 'utf8')
    })
  }
  return new UnconfiguredSmtpTransport()
}

function toEml(message: TransportMessage, config: TransportConfig): string {
  const lines = [
    `From: ${config.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    message.text,
  ]
  return lines.join('\r\n')
}

/** 1 m, 5 m, 30 m, 2 h, 6 h. After the fifth retry the message is terminal. */
export const RETRY_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000] as const
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length

export function nextAttemptDelay(attempts: number): number | null {
  if (attempts > MAX_ATTEMPTS) return null
  return RETRY_BACKOFF_MS[Math.max(0, attempts - 1)] ?? null
}

export function isPermanentStatus(status: number): boolean {
  return status >= 500 && status < 600
}

export { notifications, notificationLinks } from '@cls/db/schema'
