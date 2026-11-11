/** @jsxRuntime automatic */
/**
 * Paginated line table shared by every document.
 *
 * The header row is `fixed`, so it repeats at the top of every page the table
 * continues onto. Rows never split across pages; a long unbroken token wraps in
 * its own cell instead of running off the page.
 */
import { StyleSheet, Text, View } from '@react-pdf/renderer'
import { COLORS, FONT_BODY, FONT_SIZE } from '../theme'

export type LineTableAlign = 'left' | 'right' | 'center'

export interface LineTableColumn {
  readonly key: string
  readonly label: string
  /** Width in points. Column widths must add up to the 516 pt content width. */
  readonly width: number
  readonly align?: LineTableAlign
}

export interface LineTableRow {
  readonly key: string
  readonly cells: Readonly<Record<string, string>>
}

export interface LineTableProps {
  readonly columns: readonly LineTableColumn[]
  readonly rows: readonly LineTableRow[]
  readonly emptyLabel?: string
}

export function LineTable({ columns, rows, emptyLabel = 'No line items.' }: LineTableProps) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow} fixed>
        {columns.map((column) => (
          <Text
            key={column.key}
            style={[styles.headerCell, { width: column.width, textAlign: column.align ?? 'left' }]}
          >
            {column.label}
          </Text>
        ))}
      </View>

      {rows.length === 0 ? (
        <Text style={styles.empty}>{emptyLabel}</Text>
      ) : (
        rows.map((row) => (
          <View key={row.key} style={styles.row} wrap={false}>
            {columns.map((column) => (
              <Text
                key={column.key}
                style={[styles.cell, { width: column.width, textAlign: column.align ?? 'left' }]}
              >
                {row.cells[column.key] ?? ''}
              </Text>
            ))}
          </View>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  table: {
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.band,
    paddingVertical: 5,
    paddingHorizontal: 2,
    borderBottomWidth: 0.75,
    borderBottomColor: COLORS.rule,
  },
  headerCell: {
    fontFamily: FONT_BODY,
    fontWeight: 500,
    fontSize: FONT_SIZE.micro,
    letterSpacing: 0.5,
    color: COLORS.muted,
    textTransform: 'uppercase',
    paddingLeft: 4,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 4.5,
    paddingHorizontal: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.faintRule,
  },
  cell: {
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.small,
    lineHeight: 1.35,
    color: COLORS.ink,
    paddingLeft: 4,
  },
  empty: {
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.small,
    color: COLORS.muted,
    paddingVertical: 8,
  },
})
