import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, RefreshCw, Send } from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  Input,
  Select,
  Tag,
  Textarea,
  formatDateTime,
} from '../../../modules/work-orders/components/ui'
import { getSessionFn } from '../../../server/auth.functions'
import {
  createThreadFn,
  getThreadFn,
  listMessageUsersFn,
  listNotificationsFn,
  listOutboxFn,
  listThreadsFn,
  markNotificationReadFn,
  markThreadReadFn,
  replyThreadFn,
  retryNotificationFn,
} from '../../../modules/messaging/server/messaging.functions'

export const Route = createFileRoute('/_app/messages/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/messages' } })
    return { session }
  },
  component: MessagesPage,
})

type Tab = 'threads' | 'notifications' | 'outbox'

function MessagesPage() {
  const { session } = Route.useRouteContext()
  const [tab, setTab] = useState<Tab>('threads')
  const isAdmin = session.user.grants.some((grant) => grant.key === 'messages:admin')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Admin
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            Messages
          </h1>
          <p className="mt-1 max-w-[75ch] text-[13.5px] text-fg-secondary">
            Internal staff threads and the notification centre. Email leaves through the durable
            outbox only; nothing is sent inside a request.
          </p>
        </div>
        <div className="flex gap-1.5">
          <TabButton active={tab === 'threads'} onClick={() => setTab('threads')}>
            Threads
          </TabButton>
          <TabButton active={tab === 'notifications'} onClick={() => setTab('notifications')}>
            Notifications
          </TabButton>
          {isAdmin ? (
            <TabButton active={tab === 'outbox'} onClick={() => setTab('outbox')}>
              Outbox
            </TabButton>
          ) : null}
        </div>
      </div>

      {tab === 'threads' ? <Threads /> : null}
      {tab === 'notifications' ? <NotificationCentre /> : null}
      {tab === 'outbox' && isAdmin ? <Outbox /> : null}
    </div>
  )
}

function Threads() {
  const queryClient = useQueryClient()
  const threads = useQuery({
    queryKey: ['message-threads'],
    queryFn: () => listThreadsFn({ data: {} }),
  })
  const people = useQuery({
    queryKey: ['message-users'],
    queryFn: () => listMessageUsersFn({ data: {} }),
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [subject, setSubject] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [opening, setOpening] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)

  const activeId = selected ?? threads.data?.[0]?.id ?? null
  const detail = useQuery({
    queryKey: ['message-thread', activeId],
    queryFn: () => getThreadFn({ data: { id: activeId! } }),
    enabled: Boolean(activeId),
  })

  const create = useMutation({
    mutationFn: () =>
      createThreadFn({ data: { subject, body: opening, participantIds } }),
    onSuccess: async (result) => {
      setSubject('')
      setOpening('')
      setParticipantIds([])
      setShowNew(false)
      setSelected(result.id)
      await queryClient.invalidateQueries({ queryKey: ['message-threads'] })
    },
    onError: (cause) => setError(cause.message),
  })
  const send = useMutation({
    mutationFn: () => replyThreadFn({ data: { id: activeId!, body: reply } }),
    onSuccess: async () => {
      setReply('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['message-thread', activeId] }),
        queryClient.invalidateQueries({ queryKey: ['message-threads'] }),
      ])
    },
    onError: (cause) => setError(cause.message),
  })

  async function openThread(id: string) {
    setSelected(id)
    await markThreadReadFn({ data: { id } }).catch(() => undefined)
    await queryClient.invalidateQueries({ queryKey: ['message-threads'] })
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setShowNew((value) => !value)}>
          <Plus size={14} aria-hidden="true" /> New thread
        </Button>
      </div>
      {error ? <ErrorPanel message={error} /> : null}
      {showNew ? (
        <Card title="New thread">
          <div className="space-y-3">
            <Field label="Subject">
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
            </Field>
            <div>
              <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
                Participants
              </span>
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-[4px] border border-hair p-2 sm:grid-cols-2 lg:grid-cols-3">
                {(people.data ?? []).map((person) => (
                  <label key={person.id} className="flex items-center gap-2 text-[12.5px]">
                    <input
                      type="checkbox"
                      checked={participantIds.includes(person.id)}
                      onChange={(event) =>
                        setParticipantIds((current) =>
                          event.target.checked
                            ? [...current, person.id]
                            : current.filter((id) => id !== person.id),
                        )
                      }
                    />
                    {person.name}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Opening message">
              <Textarea
                rows={4}
                value={opening}
                onChange={(event) => setOpening(event.target.value)}
              />
            </Field>
            <Button
              disabled={create.isPending || !subject.trim() || !opening.trim() || participantIds.length === 0}
              onClick={() => create.mutate()}
            >
              Start thread
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="rounded-[5px] border border-hair bg-surface">
          {threads.isPending ? (
            <p className="p-3 text-[13px] text-fg-muted">Loading threads…</p>
          ) : null}
          {threads.data?.length === 0 ? (
            <EmptyState title="No threads" description="Start a thread with another staff user." />
          ) : null}
          <ul data-testid="message-threads">
            {(threads.data ?? []).map((thread) => (
              <li key={thread.id} className="border-b border-hair last:border-b-0">
                <button
                  type="button"
                  onClick={() => void openThread(thread.id)}
                  className={`w-full px-3 py-2.5 text-left ${
                    activeId === thread.id ? 'bg-surface-2' : 'hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium text-fg">{thread.subject}</span>
                    {thread.unread > 0 ? <Tag tone="info">{thread.unread} new</Tag> : null}
                  </div>
                  <div className="truncate text-[11.5px] text-fg-muted">{thread.preview}</div>
                  <div className="text-[11px] text-fg-muted">
                    {thread.participants.join(', ')} · {formatDateTime(thread.lastMessageAt)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[5px] border border-hair bg-surface p-4" data-testid="message-thread">
          {!activeId ? (
            <EmptyState title="Select a thread" description="Pick a thread on the left." />
          ) : detail.isPending ? (
            <p className="text-[13px] text-fg-muted">Loading thread…</p>
          ) : detail.error ? (
            <ErrorPanel message={detail.error.message} />
          ) : detail.data ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-[15px] font-semibold text-fg">{detail.data.subject}</h2>
                <p className="text-[12px] text-fg-muted">
                  {detail.data.participants.map((person) => person.name).join(', ')}
                </p>
              </div>
              <ul className="max-h-[420px] space-y-2 overflow-y-auto">
                {detail.data.messages.map((message) => (
                  <li
                    key={message.id}
                    className={`rounded-[4px] border px-3 py-2 ${
                      message.mine ? 'border-brand/30 bg-surface-2' : 'border-hair'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 text-[11.5px] text-fg-muted">
                      <span className="font-medium text-fg">{message.author}</span>
                      <span>{formatDateTime(message.createdAt)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-fg">{message.body}</p>
                  </li>
                ))}
              </ul>
              <div className="space-y-2">
                <Textarea
                  aria-label="Reply"
                  rows={3}
                  placeholder="Reply to the thread…"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
                <Button
                  disabled={send.isPending || !reply.trim()}
                  onClick={() => send.mutate()}
                >
                  <Send size={14} aria-hidden="true" /> Reply
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function NotificationCentre() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const query = useQuery({
    queryKey: ['notifications', status],
    queryFn: () => listNotificationsFn({ data: { status: status || undefined, pageSize: 100 } }),
  })
  const read = useMutation({
    mutationFn: (id: string) => markNotificationReadFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Notification status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="max-w-[220px]"
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </Select>
        <Button variant="ghost" onClick={() => void query.refetch()}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </Button>
        <span className="ml-auto text-[12px] text-fg-muted">
          {query.data ? `${query.data.unread} unread · ${query.data.total} total` : ''}
        </span>
      </div>
      {query.error ? <ErrorPanel message={query.error.message} /> : null}
      {query.data?.rows.length === 0 ? (
        <EmptyState
          title="No notifications"
          description="Messages addressed to you appear here as the outbox produces them."
        />
      ) : null}
      <ul className="space-y-2" data-testid="notification-list">
        {(query.data?.rows ?? []).map((notification) => (
          <li
            key={notification.id}
            className={`rounded-[5px] border bg-surface p-3 ${
              notification.readAt ? 'border-hair' : 'border-brand/40'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-fg">{notification.subject}</span>
                  <Tag tone={notification.status === 'failed' ? 'danger' : 'neutral'}>
                    {notification.status}
                  </Tag>
                  <Tag tone="neutral">{notification.kind}</Tag>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-fg-secondary">
                  {notification.bodyText}
                </p>
                <div className="mt-1 text-[11.5px] text-fg-muted">
                  {formatDateTime(notification.createdAt)}
                  {notification.attempts > 0 ? ` · ${notification.attempts} attempt(s)` : ''}
                  {notification.lastError ? ` · ${notification.lastError}` : ''}
                </div>
              </div>
              {!notification.readAt ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => read.mutate(notification.id)}
                >
                  Mark read
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Outbox() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const query = useQuery({
    queryKey: ['notification-outbox', status],
    queryFn: () => listOutboxFn({ data: { status: status || undefined } }),
  })
  const retry = useMutation({
    mutationFn: (id: string) => retryNotificationFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-outbox'] }),
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Outbox status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="max-w-[220px]"
        >
          <option value="">All statuses</option>
          {['queued', 'sending', 'sent', 'failed', 'skipped', 'suppressed'].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Button variant="ghost" onClick={() => void query.refetch()}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </Button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {Object.entries(query.data?.counts ?? {}).map(([key, count]) => (
            <Tag key={key} tone={key === 'failed' ? 'danger' : 'neutral'}>
              {key} {count}
            </Tag>
          ))}
        </div>
      </div>
      {query.error ? <ErrorPanel message={query.error.message} /> : null}
      {query.data?.rows.length === 0 ? (
        <EmptyState title="Outbox empty" description="No message matches the current filter." />
      ) : null}
      <div className="overflow-x-auto rounded-[5px] border border-hair bg-surface">
        <table className="w-full text-left text-[12.5px]" data-testid="notification-outbox">
          <thead className="bg-surface-2 text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
            <tr>
              <th className="px-3 py-2">Message</th>
              <th className="px-3 py-2">Recipient</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Attempts</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(query.data?.rows ?? []).map((row) => (
              <tr key={row.id} className="border-t border-hair align-top">
                <td className="px-3 py-2">
                  <div className="font-medium text-fg">{row.subject}</div>
                  <div className="text-[11.5px] text-fg-muted">
                    {row.kind} · {row.templateKey}
                    {row.entityType ? ` · ${row.entityType} ${row.entityId ?? ''}` : ''}
                  </div>
                  {row.lastError ? (
                    <div className="mt-1 text-[11.5px] text-red-700">{row.lastError}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {row.recipientName ?? '—'}
                  <div className="text-[11.5px] text-fg-muted">{row.recipient ?? 'no email'}</div>
                </td>
                <td className="px-3 py-2">
                  <Tag tone={row.status === 'failed' ? 'danger' : row.status === 'sent' ? 'info' : 'neutral'}>
                    {row.status}
                  </Tag>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.attempts}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatDateTime(row.createdAt)}
                  {row.status === 'queued' ? (
                    <div className="text-[11.5px] text-fg-muted">
                      next {formatDateTime(row.nextAttemptAt)}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {row.status === 'failed' || row.status === 'skipped' ? (
                    <Button variant="secondary" size="sm" onClick={() => retry.mutate(row.id)}>
                      Retry
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button variant={active ? 'primary' : 'secondary'} className="h-8 px-3 text-[12.5px]" onClick={onClick}>
      {children}
    </Button>
  )
}
