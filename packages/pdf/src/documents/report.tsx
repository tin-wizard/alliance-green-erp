/** @jsxRuntime automatic */
/**
 * Generic tabular report. The module owns the query, column labels, formatting
 * and totals; this component only prints them.
 */
import { StyleSheet, Text, View } from '@react-pdf/renderer'
import { DocumentShell } from '../components/DocumentShell'
import { COLORS, FONT_BODY, FONT_SIZE } from '../theme'
import { formatIsoDate } from '../format'
import type { ReportDocumentData } from '../types'

export interface ReportDocumentProps {
  readonly data: ReportDocumentData
}

export function ReportDocument({ data }: ReportDocumentProps) {
  return (
    <DocumentShell
      title={data.title}
      number={formatIsoDate(data.generatedOn) ?? data.generatedOn}
      meta={[{ label: 'Rows', value: String(data.rows.length) }]}
      footerNote="Alliance Lighting · Report"
    >
      {data.subtitle ? <Text style={styles.subtitle}>{data.subtitle}</Text> : null}
      {data.filters.length ? <Text style={styles.filters}>{data.filters.join(' · ')}</Text> : null}

      <View style={styles.table}>
        <View style={[styles.row, styles.headerRow]} fixed>
          {data.columns.map((column) => (
            <Text
              key={column.label}
              style={[
                styles.cell,
                styles.headerCell,
                column.align === 'right' ? styles.right : styles.left,
              ]}
            >
              {column.label}
            </Text>
          ))}
        </View>
        {data.rows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.row} wrap={false}>
            {data.columns.map((column, columnIndex) => (
              <Text
                key={`${column.label}-${columnIndex}`}
                style={[
                  styles.cell,
                  column.align === 'right' ? styles.right : styles.left,
                ]}
              >
                {row[columnIndex] ?? ''}
              </Text>
            ))}
          </View>
        ))}
        {data.totals?.length ? (
          <View style={[styles.row, styles.totalRow]} wrap={false}>
            {data.columns.map((column, columnIndex) => (
              <Text
                key={`total-${column.label}-${columnIndex}`}
                style={[
                  styles.cell,
                  styles.totalCell,
                  column.align === 'right' ? styles.right : styles.left,
                ]}
              >
                {data.totals?.[columnIndex] ?? ''}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </DocumentShell>
  )
}

const styles = StyleSheet.create({
  subtitle: {
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.body,
    color: COLORS.ink,
    marginBottom: 2,
  },
  filters: {
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.micro,
    color: COLORS.muted,
    marginBottom: 10,
  },
  table: {
    marginTop: 4,
    borderTopWidth: 0.75,
    borderTopColor: COLORS.faintRule,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.faintRule,
    minHeight: 14,
    alignItems: 'stretch',
  },
  headerRow: {
    backgroundColor: COLORS.band,
  },
  totalRow: {
    backgroundColor: COLORS.band,
    borderTopWidth: 0.75,
    borderTopColor: COLORS.ink,
  },
  cell: {
    flexGrow: 1,
    flexBasis: 0,
    paddingHorizontal: 3,
    paddingVertical: 3,
    fontFamily: FONT_BODY,
    fontSize: 6.4,
    color: COLORS.ink,
  },
  headerCell: {
    fontWeight: 600,
    fontSize: 6.2,
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  totalCell: {
    fontWeight: 600,
  },
  left: {
    textAlign: 'left',
  },
  right: {
    textAlign: 'right',
  },
})
