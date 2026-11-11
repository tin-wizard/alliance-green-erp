import type postgres from 'postgres'

/**
 * Guard for E2E database access.
 *
 * Tests own rows, never the schema. A drop or alter in a test is how the shared
 * `app` schema gets destroyed for every other suite, so every statement is
 * checked before it reaches Postgres and DDL fails loudly in the test that tried
 * it. Schema changes belong in a migration.
 */
const DDL =
  /\b(alter|create|drop|truncate|grant|revoke|comment\s+on)\s+(table|schema|index|view|type|sequence|extension|database|role|function|trigger|column)\b/i

export function assertDataOnlySql(text: string): void {
  if (DDL.test(text)) {
    throw new Error(`E2E test attempted schema DDL; tests must not mutate app.*:\n${text}`)
  }
}

type Sql = ReturnType<typeof postgres>

export function dataOnly(client: Sql): Sql {
  return new Proxy(client, {
    apply(target, thisArg, args: unknown[]) {
      const [first] = args
      if (Array.isArray(first)) assertDataOnlySql((first as string[]).join('?'))
      return Reflect.apply(target, thisArg, args)
    },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value === 'function') return value.bind(target)
      return value
    },
  }) as Sql
}
