import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Input } from '../../work-orders/components/ui'
import { searchTjxSitesFn } from '../server/quotes.functions'
import type { SiteLookupOption } from '../../work-orders/types'

export function TjxSitePicker({
  selected,
  onSelect,
}: {
  selected: SiteLookupOption | null
  onSelect: (site: SiteLookupOption | null) => void
}) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const results = useQuery({
    queryKey: ['tjx', 'sites', term],
    queryFn: () => searchTjxSitesFn({ data: { search: term, limit: 10 } }),
    enabled: open,
  })

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[4px] border border-hair bg-subtle px-3 py-2">
        <div>
          <p className="text-[13px] font-medium">{selected.name}</p>
          <p className="text-[11.5px] text-fg-muted">
            {selected.customerName || 'No billing customer'} · {selected.city}, {selected.province}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
          Change
        </Button>
      </div>
    )
  }

  return (
    <div className="relative">
      <Input
        placeholder="Search sites or customers…"
        value={term}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setTerm(event.target.value)
          setOpen(true)
        }}
      />
      {open ? (
        <div className="absolute z-20 mt-1 max-h-[240px] w-full overflow-y-auto rounded-[4px] border border-hair bg-canvas shadow-md">
          {results.isPending ? (
            <p className="px-3 py-2 text-[12px] text-fg-muted">Searching…</p>
          ) : (results.data ?? []).length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-fg-muted">No sites match.</p>
          ) : (
            (results.data ?? []).map((site) => (
              <button
                key={site.id}
                type="button"
                className="block w-full border-b border-hair px-3 py-2 text-left last:border-0 hover:bg-subtle"
                onClick={() => {
                  onSelect(site)
                  setOpen(false)
                }}
              >
                <span className="block text-[13px] font-medium">{site.name}</span>
                <span className="block text-[11.5px] text-fg-muted">
                  {site.customerName || 'No billing customer'} · {site.street}, {site.city}{' '}
                  {site.province}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
