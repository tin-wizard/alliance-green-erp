import { createFileRoute } from '@tanstack/react-router'
import { getStorage } from '@cls/storage'

/**
 * Authenticated fallback for local storage, which cannot issue signed URLs.
 * S3 installs never reach this route; they get a short-lived signed URL instead.
 */
export const Route = createFileRoute('/api/master-data/documents/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { loadSessionFromRequest } = await import('@cls/auth')
        const { grantsInclude } = await import('@cls/auth/permissions')
        const session = await loadSessionFromRequest(request)
        if (!session) return new Response('Authentication required.', { status: 401 })
        if (!grantsInclude(session.user.grants, 'compliance:read')) {
          return new Response('Forbidden.', { status: 403 })
        }

        const { loadDocumentForView } = await import(
          '../../../../modules/master-data/server/documents.server'
        )
        const { getDb } = await import('@cls/db')
        const document = await loadDocumentForView(getDb(), params.id)
        if (!document?.storageKey) return new Response('Document not found.', { status: 404 })

        try {
          const object = await getStorage('assets').get(document.storageKey)
          return new Response(new Uint8Array(object.body), {
            headers: {
              'content-type': document.contentType ?? object.contentType ?? 'application/octet-stream',
              'content-disposition': `inline; filename="${(document.fileName ?? 'document').replace(/[^\w.\- ]+/g, '_')}"`,
              'cache-control': 'private, no-store',
              'x-content-type-options': 'nosniff',
            },
          })
        } catch {
          return new Response('Document not found.', { status: 404 })
        }
      },
    },
  },
})
