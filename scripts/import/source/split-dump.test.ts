import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SplitDumpSource } from './split-dump'

const dir = mkdtempSync(join(tmpdir(), 'split-dump-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const header = "/*!40101 SET NAMES latin1 */;\n"
writeFileSync(
  join(dir, 'things.sql'),
  `${header}CREATE TABLE \`things\` (\n  \`id\` int(11) NOT NULL,\n  \`name\` varchar(20) DEFAULT NULL,\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB;\nINSERT INTO \`things\` VALUES (1,'a'),(2,NULL);\nINSERT INTO \`things\` VALUES (3,'c');\n`,
)

describe('SplitDumpSource', () => {
  const source = new SplitDumpSource(dir, { sha256: 'abc', sizeBytes: 10, path: '/orig.sql' })

  it('lists tables from the files and reports the original identity', async () => {
    expect(await source.listTables()).toEqual(['things'])
    expect(source.dumpInfo().dumpId).toBe('sha256:abc')
  })

  it('reads a table in slices that add up to the whole table', async () => {
    const slices: Array<{ rows: unknown[] }> = []
    for await (const slice of source.readTableSlices('things', 1)) slices.push(slice)
    const whole = await source.readTable('things')
    expect(slices.flatMap((slice) => slice.rows)).toEqual(whole.rows)
    expect(slices.length).toBeGreaterThan(1)
  })

  it('reads one table, and an absent table as empty', async () => {
    const things = await source.readTable('things')
    expect(things.rows).toHaveLength(3)
    expect((await source.readTable('missing')).rows).toEqual([])
  })
})
