import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Boxes, Grid2X2, Layers, Tags } from 'lucide-react'
import { Card } from '../../../modules/work-orders/components/ui'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/tjx/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/tjx' } })
    return { session }
  },
  component: TjxLandingPage,
})

const MASTER_LINKS = [
  {
    to: '/tjx/masters/rooms',
    title: 'Rooms',
    description: 'The room names and order used by every TJX quote.',
    icon: Grid2X2,
  },
  {
    to: '/tjx/masters/templates',
    title: 'Room templates',
    description: 'Named lists of rooms; the default is copied into each new quote.',
    icon: Layers,
  },
  {
    to: '/tjx/masters/fixtures',
    title: 'Fixtures & parts',
    description: 'Fixture definitions with per-part markup and ratio per fixture.',
    icon: Boxes,
  },
  {
    to: '/tjx/masters/rates',
    title: 'Subcontractor rates',
    description: 'TJX install cost per part, by subcontractor.',
    icon: Tags,
  },
] as const

function TjxLandingPage() {
  return (
    <div className="space-y-5">
      <div className="border-b border-hair pb-5 pt-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Sales</p>
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
          TJX program
        </h1>
        <p className="mt-1 max-w-[72ch] text-[13.5px] text-fg-secondary">
          Fixture quotes for TJX banners, priced by room and fixture with separate markup and cost
          views. Start with the masters below; quote entry arrives with the next milestone.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {MASTER_LINKS.map((item) => {
          const Icon = item.icon
          return (
            <Link key={item.to} to={item.to} className="block">
              <Card>
                <div className="flex items-start gap-3">
                  <span className="rounded-[4px] border border-hair p-2 text-brand">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-[14px] font-medium text-fg">{item.title}</span>
                    <span className="mt-0.5 block text-[12.5px] text-fg-secondary">
                      {item.description}
                    </span>
                  </span>
                </div>
              </Card>
            </Link>
          )
        })}
      </div>

      <Card title="Quotes">
        <p className="px-1 py-6 text-center text-[13px] text-fg-muted">
          Quote entry is the next milestone. The masters above are ready for it.
        </p>
      </Card>
    </div>
  )
}
