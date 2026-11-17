import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Button,
  Card,
  ErrorPanel,
  Input,
  EmptyState,
  formatDateTime,
  formatQuantity,
} from '../../../../modules/work-orders/components/ui'
import {
  listSubStockFn,
  markSubStockMessageReadFn,
  setSubStockSubscriptionFn,
} from '../../../../modules/inventory/server/inventory.functions'
import { getSessionFn } from '../../../../server/auth.functions'

export const Route = createFileRoute('/_app/portal/sub/stock')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/portal/sub/stock' } })
    if (!session.user.grants.some((grant) => grant.key === 'inventory:sub_stock')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: SubStockPage,
})

function SubStockPage() {
  const queryClient = useQueryClient()
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const portal = useQuery({
    queryKey: ['sub-stock', search],
    queryFn: () => listSubStockFn({ data: { search } }),
  })
  const markRead = useMutation({
    mutationFn: (id: number) => markSubStockMessageReadFn({ data: { id } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sub-stock'] }),
  })
  const subscribe = useMutation({
    mutationFn: (containStock: boolean) => setSubStockSubscriptionFn({ data: { containStock } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sub-stock'] }),
  })

  const subscribed = portal.data?.subscriptions.some((row) => row.containStock) ?? false

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Subcontractor portal
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">Stock</h1>
          <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
            Parts your company can see, plus stock messages from the office. Parts the office marks
            hidden never appear here.
          </p>
        </div>
        <Link
          to="/portal/sub/work-orders"
          search={{ view: 'all', sort: 'newest', size: 25 }}
          className="text-[13px] text-brand underline"
        >
          Your work orders
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Card title="Visible parts">
          <form
            className="mb-3 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setSearch(term.trim())
            }}
          >
            <Input
              data-testid="sub-stock-search"
              aria-label="Search visible stock"
              placeholder="Part number…"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
            <Button type="submit">Search</Button>
          </form>
          {portal.isPending ? <p className="text-[13px] text-fg-muted">Loading stock…</p> : null}
          {portal.error ? <ErrorPanel message={portal.error.message} /> : null}
          {portal.data && portal.data.parts.length === 0 ? (
            <EmptyState
              title="No visible parts"
              description="The office has not shared stock yet."
            />
          ) : null}
          {portal.data && portal.data.parts.length > 0 ? (
            <table className="w-full text-left text-[13px]">
              <thead className="text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                <tr>
                  <th className="pb-2">Part</th>
                  <th className="pb-2 text-right">Available</th>
                </tr>
              </thead>
              <tbody>
                {portal.data.parts.map((part) => (
                  <tr key={part.partNumber} className="border-t border-hair">
                    <td className="py-2">
                      <span
                        className="font-mono text-[12.5px]"
                        data-testid={`sub-stock-part-${part.partNumber}`}
                      >
                        {part.partNumber}
                      </span>
                      {part.name && part.name !== part.partNumber ? (
                        <span className="ml-2 text-[12px] text-fg-muted">{part.name}</span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatQuantity(part.currentQuantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>

        <div className="space-y-5">
          <Card title={`Messages${portal.data?.unread ? ` · ${portal.data.unread} unread` : ''}`}>
            {portal.data && portal.data.messages.length === 0 ? (
              <p className="text-[13px] text-fg-muted">No stock messages.</p>
            ) : null}
            <ul className="space-y-3">
              {(portal.data?.messages ?? []).map((message) => (
                <li key={message.id} className="border-b border-hair pb-3 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-medium text-fg">
                        {message.subject ?? 'Stock message'}
                      </p>
                      <p className="mt-0.5 text-[12px] text-fg-secondary">{message.message}</p>
                      <p className="mt-1 text-[11px] text-fg-muted">
                        {message.username ?? 'Office'} · {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                    {!message.isRead ? (
                      <Button
                        variant="ghost"
                        data-testid={`sub-stock-read-${message.id}`}
                        onClick={() => markRead.mutate(message.id)}
                        disabled={markRead.isPending}
                      >
                        Mark read
                      </Button>
                    ) : (
                      <span className="text-[11px] text-fg-muted">read</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Low-stock notifications">
            <p className="mb-3 text-[12.5px] text-fg-secondary">
              Receive a message when a visible part is low. This setting applies to your company.
            </p>
            <Button
              data-testid="sub-stock-subscribe"
              onClick={() => subscribe.mutate(!subscribed)}
              disabled={subscribe.isPending}
            >
              {subscribed ? 'Turn notifications off' : 'Turn notifications on'}
            </Button>
            {subscribe.error ? <ErrorPanel message={subscribe.error.message} /> : null}
          </Card>
        </div>
      </div>
    </div>
  )
}
