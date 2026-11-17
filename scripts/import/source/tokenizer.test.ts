/**
 * The tokenizer, against the literals a real dump is made of.
 *
 * Every expectation here is a claim about what MySQL stores, so the values are
 * written the way `mysqldump` writes them (`\'`, `\n`, `0x...`, zero dates) and
 * checked against the text Postgres must receive. `differential.test.ts` proves
 * the same claims against a live server.
 */
import { gzipSync } from 'node:zlib'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DumpSyntaxError,
  computeDumpId,
  decodeDumpText,
  parseDump,
  parseDumpSlices,
} from './tokenizer'
import { DumpSource } from './dump'

describe('parseDump: statement shapes', () => {
  it('reads column order from a multi-line CREATE TABLE and ignores keys', () => {
    const dump = `
-- MySQL dump 10.13  Distrib 5.7.44, for Linux (x86_64)
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES latin1 */;
DROP TABLE IF EXISTS \`parts_group\`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
CREATE TABLE \`parts_group\` (
  \`id\` int(11) NOT NULL,
  \`name\` text,
  \`sort_id\` int(11) DEFAULT NULL,
  \`is_winner\` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (\`id\`),
  KEY \`idx_name\` (\`name\`(10)),
  FULLTEXT KEY \`ft_name\` (\`name\`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;
LOCK TABLES \`parts_group\` WRITE;
/*!40000 ALTER TABLE \`parts_group\` DISABLE KEYS */;
INSERT INTO \`parts_group\` VALUES (1,'Brakes',2,0),(2,'Engine, diesel',1,1);
/*!40000 ALTER TABLE \`parts_group\` ENABLE KEYS */;
UNLOCK TABLES;
`
    const { tables, skippedTables } = parseDump(dump)

    expect(tables).toHaveLength(1)
    expect(skippedTables).toEqual([])
    expect(tables[0]!.table).toBe('parts_group')
    expect(tables[0]!.columns).toEqual(['id', 'name', 'sort_id', 'is_winner'])
    expect(tables[0]!.rows).toEqual([
      { rowNo: 1, values: { id: '1', name: 'Brakes', sort_id: '2', is_winner: '0' } },
      { rowNo: 2, values: { id: '2', name: 'Engine, diesel', sort_id: '1', is_winner: '1' } },
    ])
  })

  it('keeps a table that has a CREATE TABLE but no INSERTs', () => {
    const dump = `
CREATE TABLE \`empty_one\` (
  \`id\` int(11) NOT NULL,
  PRIMARY KEY (\`id\`)
);
INSERT INTO \`other\` VALUES (1);
`
    const { tables, skippedTables } = parseDump(dump)
    expect(tables.map((entry) => entry.table)).toEqual(['empty_one'])
    expect(tables[0]!.rows).toEqual([])
    // `other` is present in the dump but has no column names to map onto.
    expect(skippedTables).toEqual(['other'])
  })

  it('takes column names from the INSERT when the dump has no CREATE TABLE', () => {
    const dump = "INSERT INTO `t` (`id`, `name`) VALUES (7, 'seven');"
    const { tables } = parseDump(dump)
    expect(tables[0]!.columns).toEqual(['id', 'name'])
    expect(tables[0]!.rows[0]!.values).toEqual({ id: '7', name: 'seven' })
  })

  it('reads mixed types in one multi-row INSERT with a column list', () => {
    const dump = `
CREATE TABLE \`t\` (
  \`id\` int(11) NOT NULL,
  \`amount\` decimal(10,2) DEFAULT NULL,
  \`kind\` enum('alpha','beta') DEFAULT NULL,
  \`note\` text
);
INSERT INTO \`t\` (\`id\`,\`kind\`,\`amount\`,\`note\`) VALUES (1,'beta',-1234.50,'x'),(2,NULL,0.00,NULL),(3,'alpha',9.5,'');
`
    const { tables } = parseDump(dump)
    expect(tables[0]!.columns).toEqual(['id', 'amount', 'kind', 'note'])
    // The list names the columns out of declared order, so mapping by position
    // would put 'beta' in `amount`. mysqldump emits both shapes.
    expect(tables[0]!.rows).toEqual([
      { rowNo: 1, values: { id: '1', amount: '-1234.50', kind: 'beta', note: 'x' } },
      { rowNo: 2, values: { id: '2', amount: '0.00', kind: null, note: null } },
      { rowNo: 3, values: { id: '3', amount: '9.5', kind: 'alpha', note: '' } },
    ])
  })

  it('nulls a declared column the INSERT column list omits', () => {
    const dump = `
CREATE TABLE \`t\` (\`a\` int(11), \`b\` int(11), \`c\` int(11));
INSERT INTO \`t\` (\`c\`,\`a\`) VALUES (30,10);
`
    const { tables } = parseDump(dump)
    expect(tables[0]!.columns).toEqual(['a', 'b', 'c'])
    expect(tables[0]!.rows[0]!.values).toEqual({ a: '10', b: null, c: '30' })
  })

  it('decodes a 0x hex literal as latin1 bytes', () => {
    const dump = `
CREATE TABLE \`t\` (\`id\` int(11) NOT NULL, \`raw\` varbinary(10));
INSERT INTO \`t\` VALUES (1,0x414243),(2,0xE9);
`
    const { tables } = parseDump(dump)
    expect(tables[0]!.rows.map((row) => row.values.raw)).toEqual(['ABC', 'é'])
  })

  it('skips DELIMITER blocks and function bodies', () => {
    const dump = `
CREATE TABLE \`t\` (\`id\` int(11) NOT NULL);
INSERT INTO \`t\` VALUES (1);
DELIMITER ;;
/*!50003 CREATE*/ /*!50003 TRIGGER \`t_bu\` BEFORE UPDATE ON \`t\` FOR EACH ROW BEGIN SET @x = 1; END */;;
DELIMITER ;
INSERT INTO \`t\` VALUES (2);
`
    const { tables } = parseDump(dump)
    expect(tables[0]!.rows.map((row) => row.values.id)).toEqual(['1', '2'])
  })

  it('reports what an include filter left behind', () => {
    const dump = `
CREATE TABLE \`keep\` (\`id\` int(11) NOT NULL);
CREATE TABLE \`drop\` (\`id\` int(11) NOT NULL);
INSERT INTO \`keep\` VALUES (1);
INSERT INTO \`drop\` VALUES (1);
`
    const { tables, skippedTables } = parseDump(dump, { include: ['keep'] })
    expect(tables.map((entry) => entry.table)).toEqual(['keep'])
    expect(skippedTables).toEqual(['drop'])
  })
})

describe('parseDump: values', () => {
  // `String.raw` keeps the SQL exactly as written, which is the point: these are
  // the bytes mysqldump puts in the file. No backticks appear, so no escaping.
  const dumpOf = (insert: string): string =>
    String.raw`
CREATE TABLE t (id int(11) NOT NULL, v text);
` + insert
  it('unescapes every MySQL string escape the server would', () => {
    const dump = dumpOf(
      String.raw`INSERT INTO t VALUES (1,'it\'s a \"quote\" and a \\ and a \n and a \r and a \t and a \0 and a \Z');`,
    )
    const { tables } = parseDump(dump)
    expect(tables[0]!.rows[0]!.values.v).toBe(
      'it\'s a "quote" and a \\ and a \n and a \r and a \t and a \0 and a \u001a',
    )
  })

  it('keeps the backslash on \\% and \\_, which MySQL only strips in LIKE patterns', () => {
    const dump = dumpOf(String.raw`INSERT INTO t VALUES (1,'100\% off a\_b');`)
    const { tables } = parseDump(dump)
    expect(tables[0]!.rows[0]!.values.v).toBe(String.raw`100\% off a\_b`)
  })

  it('reads a doubled quote inside a single-quoted string as one quote', () => {
    const dump = dumpOf(String.raw`INSERT INTO t VALUES (1,'it''s');`)
    const { tables } = parseDump(dump)
    expect(tables[0]!.rows[0]!.values.v).toBe("it's")
  })

  it('distinguishes NULL from the empty string', () => {
    const dump = dumpOf(`INSERT INTO t VALUES (1,NULL),(2,'');`)
    const { tables } = parseDump(dump)
    expect(tables[0]!.rows[0]!.values.v).toBeNull()
    expect(tables[0]!.rows[1]!.values.v).toBe('')
  })

  it('keeps zero dates as literal text', () => {
    const dump = `
CREATE TABLE \`t\` (\`d\` date, \`ts\` datetime, \`real\` datetime);
INSERT INTO \`t\` VALUES ('0000-00-00','0000-00-00 00:00:00','2024-02-29 23:59:58');
`
    const { tables } = parseDump(dump)
    expect(tables[0]!.rows[0]!.values).toEqual({
      d: '0000-00-00',
      ts: '0000-00-00 00:00:00',
      real: '2024-02-29 23:59:58',
    })
  })

  it('treats ; -- # and /* inside a value as content, not syntax', () => {
    const dump = dumpOf(
      String.raw`INSERT INTO t VALUES (1,'a; b -- c # d /* e */ f'),(2,'still here');`,
    )
    const { tables } = parseDump(dump)
    expect(tables).toHaveLength(1)
    expect(tables[0]!.rows[0]!.values.v).toBe('a; b -- c # d /* e */ f')
    expect(tables[0]!.rows[1]!.values.v).toBe('still here')
  })

  it('accepts a raw newline inside a value spanning lines', () => {
    const dump = dumpOf("INSERT INTO t VALUES (1,'line one\nline two');")
    const { tables } = parseDump(dump)
    expect(tables[0]!.rows[0]!.values.v).toBe('line one\nline two')
  })

  it('unwraps a _binary introducer', () => {
    const dump = dumpOf(String.raw`INSERT INTO t VALUES (1,_binary 'abc\0def');`)
    const { tables } = parseDump(dump)
    expect(tables[0]!.rows[0]!.values.v).toBe('abc\0def')
  })

  it('decodes latin1 bytes exactly once', () => {
    const bytes = Buffer.concat([
      Buffer.from("CREATE TABLE t (v text);\nINSERT INTO t VALUES ('", 'latin1'),
      // 0x80 is a C1 control in ISO-8859-1, not the euro sign: the dump is
      // latin1, and treating it as cp1252 here is how accents get corrupted.
      Buffer.from([0xe9, 0xfc, 0xf1, 0x20, 0xa3]),
      Buffer.from("');\n", 'latin1'),
    ])

    const text = decodeDumpText(bytes)
    const { tables } = parseDump(text)
    const value = tables[0]!.rows[0]!.values.v!

    // The bytes were latin1; the value that reaches staging is the UTF-8 text.
    expect(value).toBe('éüñ £')
    expect(Buffer.from(value, 'utf8').toString('hex')).toBe('c3a9c3bcc3b120c2a3')
  })

  it('rejects an unterminated string instead of truncating a row', () => {
    expect(() => parseDump("CREATE TABLE t (v text);\nINSERT INTO t VALUES ('oops);")).toThrow(
      DumpSyntaxError,
    )
  })

  it('rejects a row whose value count does not match the columns', () => {
    expect(() =>
      parseDump('CREATE TABLE `t` (`a` int, `b` int);\nINSERT INTO `t` VALUES (1);'),
    ).toThrow(/has 1 values for 2 columns/)
  })
})

describe('computeDumpId', () => {
  it('is the sha256 hex of the bytes it is given', () => {
    expect(computeDumpId('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(computeDumpId(Buffer.from('abc', 'latin1'))).toBe(computeDumpId('abc'))
  })
})

describe('DumpSource', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dump-source-'))

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  const sql =
    "CREATE TABLE `t` (`id` int(11) NOT NULL, `v` text);\nINSERT INTO `t` VALUES (1,'é');\n"

  it('reads a plain .sql and reports the hash of its bytes', async () => {
    const path = join(directory, 'dump.sql')
    writeFileSync(path, sql, 'latin1')

    const source = new DumpSource(path)
    expect(await source.listTables()).toEqual(['t'])
    expect((await source.readTable('t')).rows[0]!.values.v).toBe('é')

    const info = source.dumpInfo()
    expect(info.dumpId).toBe(`sha256:${computeDumpId(Buffer.from(sql, 'latin1'))}`)
    expect(info.sizeBytes).toBe(Buffer.byteLength(sql, 'latin1'))
    expect(info.path).toBe(path)
  })

  it('reads a .sql.gz and hashes the uncompressed bytes', async () => {
    const path = join(directory, 'dump.sql.gz')
    writeFileSync(path, gzipSync(Buffer.from(sql, 'latin1')))

    const source = new DumpSource(path)
    expect((await source.readTable('t')).rows[0]!.values.v).toBe('é')
    expect(source.dumpInfo().checksum).toBe(computeDumpId(Buffer.from(sql, 'latin1')))
  })

  it('returns an empty table for a name the dump lacks', async () => {
    const path = join(directory, 'dump.sql')
    const source = new DumpSource(path)
    expect(await source.readTable('nope')).toEqual({ table: 'nope', columns: [], rows: [] })
  })
})

describe('parseDumpSlices', () => {
  const dump = [
    'CREATE TABLE `t` (`id` int(11) NOT NULL, `note` text, PRIMARY KEY (`id`));',
    "INSERT INTO `t` VALUES (1,'a'),(2,NULL),(3,'c');",
    "INSERT INTO `t` VALUES (4,'d'),(5,'e'),(6,'f'),(7,'g');",
    'CREATE TABLE `empty` (`id` int(11) NOT NULL);',
  ].join('\n')

  it('yields the same rows, with the same numbers, as parseDump', () => {
    const whole = parseDump(dump).tables.find((t) => t.table === 't')!
    for (const size of [1, 2, 3, 4, 100]) {
      const slices = [...parseDumpSlices(dump, size)].filter((t) => t.table === 't')
      expect(slices.flatMap((t) => t.rows)).toEqual(whole.rows)
      expect(slices.every((t) => t.columns.join() === whole.columns.join())).toBe(true)
      if (size < 7) expect(Math.max(...slices.map((t) => t.rows.length))).toBeLessThanOrEqual(size + 3)
    }
  })

  it('yields a table with no rows once, so its columns are known', () => {
    const empty = [...parseDumpSlices(dump, 2)].filter((t) => t.table === 'empty')
    expect(empty).toHaveLength(1)
    expect(empty[0]!.columns).toEqual(['id'])
    expect(empty[0]!.rows).toEqual([])
  })
})
