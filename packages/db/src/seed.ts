/**
 * Idempotent seed: permission catalogue, default role grants, bootstrap admin.
 *
 * Run with: pnpm db:seed
 *
 * Safe to re-run. It rewrites the role-default grant matrix (which is code-owned)
 * and leaves per-user grants alone. It creates the bootstrap admin row but no
 * password: credentials belong to Neon Auth. The row is linked to the Neon user
 * on that person's first sign-in (matched by email).
 */
import { sql } from 'drizzle-orm'
import { PERMISSIONS, type Role } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { logger } from '@cls/core/logger'
import { closeDb, getDb } from './client'
import { permissionDefinitions, rolePermissions, users } from './schema'

async function seedPermissions(db: ReturnType<typeof getDb>): Promise<void> {
  const rows = PERMISSIONS.map((permission, index) => ({
    key: permission.key,
    module: permission.module,
    label: permission.label,
    description: permission.description,
    sortOrder: index * 10,
  }))

  await db
    .insert(permissionDefinitions)
    .values(rows)
    .onConflictDoUpdate({
      target: permissionDefinitions.key,
      set: {
        module: sql`excluded.module`,
        label: sql`excluded.label`,
        description: sql`excluded.description`,
        sortOrder: sql`excluded.sort_order`,
      },
    })

  // Role defaults are owned by code, so replace the matrix wholesale.
  await db.delete(rolePermissions)
  const grants: { role: Role; permissionKey: string }[] = []
  for (const permission of PERMISSIONS) {
    for (const role of permission.defaultRoles) {
      grants.push({ role, permissionKey: permission.key })
    }
  }
  await db.insert(rolePermissions).values(grants)
  logger.info('Seeded permissions', { permissions: rows.length, roleGrants: grants.length })
}

async function seedAdmin(db: ReturnType<typeof getDb>): Promise<void> {
  const { seedAdmin } = getConfig()

  if (!seedAdmin.email) {
    logger.warn(
      'SEED_ADMIN_EMAIL is not set. Skipping the bootstrap admin row. Set it in .env and re-run `pnpm db:seed` if this is a new install.',
    )
    return
  }

  const existing = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${seedAdmin.email})`)
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(users)
      .set({ role: 'admin', isEnabled: true, updatedAt: new Date() })
      .where(sql`${users.id} = ${existing[0]!.id}`)
    logger.info('Admin user already exists; role ensured', { email: seedAdmin.email })
    return
  }

  await db.insert(users).values({
    email: seedAdmin.email,
    username: seedAdmin.username,
    displayName: seedAdmin.displayName,
    role: 'admin',
  })
  logger.info('Created bootstrap admin row (no password; Neon Auth owns credentials)', {
    email: seedAdmin.email,
    username: seedAdmin.username,
  })
}

async function main(): Promise<void> {
  const db = getDb()
  await seedPermissions(db)
  await seedAdmin(db)
  logger.info('Seed complete')
}

main()
  .catch((error: unknown) => {
    logger.error('Seed failed', { error })
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
