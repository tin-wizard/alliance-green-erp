/** @jsxRuntime automatic */
/** Right-aligned money summary. Prints the DTO strings verbatim. */
import { StyleSheet, Text, View } from '@react-pdf/renderer'
import { COLORS, FONT_BODY, FONT_SIZE } from '../theme'

export interface TotalsRow {
  readonly label: string
  readonly value: string
  /** The final row: heavier rule, heavier type. */
  readonly emphasis?: boolean
}

export interface TotalsProps {
  readonly rows: readonly TotalsRow[]
}

export function Totals({ rows }: TotalsProps) {
  return (
    <View style={styles.wrapper} wrap={false}>
      <View style={styles.block}>
        {rows.map((row) => (
          <View key={row.label} style={[styles.row, row.emphasis ? styles.rowEmphasis : undefined]}>
            <Text style={[styles.label, row.emphasis ? styles.labelEmphasis : undefined]}>
              {row.label}
            </Text>
            <Text style={[styles.value, row.emphasis ? styles.valueEmphasis : undefined]}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    alignItems: 'flex-end',
    marginTop: 10,
  },
  block: {
    width: 248,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2.5,
  },
  rowEmphasis: {
    marginTop: 3,
    paddingTop: 6,
    borderTopWidth: 0.75,
    borderTopColor: COLORS.ink,
  },
  label: {
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.small,
    color: COLORS.muted,
  },
  labelEmphasis: {
    fontFamily: FONT_BODY,
    fontWeight: 600,
    fontSize: 10,
    color: COLORS.ink,
  },
  value: {
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.small,
    color: COLORS.ink,
    textAlign: 'right',
  },
  valueEmphasis: {
    fontFamily: FONT_BODY,
    fontWeight: 600,
    fontSize: 10,
    color: COLORS.ink,
  },
})
