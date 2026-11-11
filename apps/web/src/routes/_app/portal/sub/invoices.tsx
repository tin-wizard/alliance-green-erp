import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/portal/sub/invoices')({
  component: () => <Outlet />,
})
