# ADR 0009 — Object storage: Neon Object Storage behind an adapter

- **Status:** Accepted
- **Date:** 2026-11-11
- **Owners:** Platform

## Context

The prior assessment assumed Cloudflare R2 for documents, work-order photos and generated PDFs.
The human instead provisioned **Neon Object Storage**, which is S3-compatible and branch-scoped:
uploading in a preview branch does not touch production, and the credential is valid for the
branch and its descendants.

The provisioned project has two buckets:

| Bucket | Access | Purpose |
|---|---|---|
| `assets` | private | work-order photos, documents, compliance files |
| `accounting` | private | generated invoices, statements, financial reports |

The app must also run offline on a developer laptop with no Neon credentials and no network, so a
filesystem fallback is required.

## Decision

1. **One interface** (`StorageAdapter`): `put`, `get`, `getSignedUrl`, `delete`, `health`.
   Modules never import the AWS SDK or read `AWS_*` / `STORAGE_*`.
2. **Two drivers.**
   - `S3StorageAdapter`: `@aws-sdk/client-s3` with a custom endpoint and **`forcePathStyle: true`**
     (required by Neon's S3 endpoint). Signed GET URLs default to 5 minutes, capped at 1 hour.
   - `LocalStorageAdapter`: files under `STORAGE_LOCAL_DIR` (default `.data/storage/<bucket>`),
     with key validation that rejects absolute paths, `..` segments and any path escaping the
     root. Local signed URLs return `null`; the app will serve files through an authenticated
     route when the document module lands.
3. **Driver selection:** `STORAGE_DRIVER=auto` (default) uses S3 when endpoint, bucket, key id and
   secret are all present, otherwise local. `s3` and `local` force a driver. Health reports
   `ok | unavailable | not_configured` with the driver and bucket.
4. **Two buckets, one factory:** `getStorage('assets')` and `getStorage('accounting')` return
   configured adapters. The split keeps lifecycle and access policy on financial output separate
   from operational evidence.
5. **Canonical key layout** (`STORAGE_LAYOUT` in `packages/storage/src/types.ts`):

   ```
   workorders/<woid>/photos/<uuid>.<ext>
   workorders/<woid>/documents/<uuid>-<filename>
   customers/<customerId>/documents/<uuid>-<filename>
   suppliers/<supplierId>/documents/<uuid>-<filename>
   subcontractors/<subId>/compliance/<uuid>-<filename>
   generated/<kind>/<yyyy>/<mm>/<uuid>.pdf      (accounting bucket)
   quarantine/<uuid>-<filename>                  (failed scan / unknown upload)
   ```

   Keys are generated server-side. Filenames are sanitised to `[A-Za-z0-9._-]`, stripped of
   directories, and capped at 120 characters; the UUID keeps them unique.
6. **Private by default.** No bucket is public. The browser receives a short-lived signed URL,
   never a credential. Metadata is stored on the object and, when the document tables land, in
   Postgres with the key, content type, size, uploader and checksum.
7. **No direct browser uploads yet.** Presigned PUT and multipart upload are deferred with the
   document module; until then uploads pass through a server function that can enforce
   permission, size and content type.

## Alternatives considered

1. **Cloudflare R2 (the prior assumption).** Not provisioned; would add a second vendor and a
   second set of credentials.
2. **Store files as `bytea` in Postgres.** Simple backup story, but bloats the database, makes
   large uploads a transaction problem, and defeats the branch-scoped object store.
3. **Local filesystem only.** Fine for one machine, but no branch isolation, no presigned URLs and
   no off-machine backup. Kept as the offline fallback instead.
4. **A generic "files SDK".** Another abstraction over the same S3 API; the AWS SDK is already
   required for signing and is well understood.

## Consequences

- **Positive:** swapping storage providers is one adapter; modules use keys, not SDK types.
- **Positive:** the layout is documented once, so backup, lifecycle and migration jobs can reason
  about prefixes without reading module code.
- **Positive:** `pnpm --filter @cls/storage smoke` proves put/get/delete against both real buckets.
- **Negative:** two buckets mean two health checks and two sets of metrics to watch.
- **Negative:** local mode cannot issue signed URLs. The document module must use an authenticated
  streaming route for local installs.
- **Risk:** Neon Object Storage is branch-scoped. A credential created on `production` works on
  descendants, not on a sibling branch from a different lineage. Documented in `platform/NEON.md`.

## Verification

- Unit tests prove local round-trip, deletion, not-found, traversal rejection, signed-URL
  behaviour and layout/filename sanitisation.
- Live smoke against the provisioned project: `assets` and `accounting` HEAD succeed; a probe
  object is written, read back byte-for-byte, signed, deleted, and confirmed gone in both buckets.
