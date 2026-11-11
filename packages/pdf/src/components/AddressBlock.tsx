/** @jsxRuntime automatic */
/** Bill-to / ship-to / vendor address block, generic to every document. */
import { StyleSheet, Text, View } from '@react-pdf/renderer'
import { addressLines } from '../format'
import type { AddressBlockData } from '../types'
import { COLORS, FONT_BODY, FONT_SIZE } from '../theme'

export interface AddressBlockProps {
  readonly label: string
  readonly data: AddressBlockData
}

export function AddressBlock({ label, data }: AddressBlockProps) {
  const lines = addressLines(data)
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.name}>{data.name}</Text>
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} style={styles.line}>
          {line}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  block: {
    width: 240,
  },
  label: {
    fontFamily: FONT_BODY,
    fontWeight: 500,
    fontSize: FONT_SIZE.micro,
    letterSpacing: 1.1,
    color: COLORS.muted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  name: {
    fontFamily: FONT_BODY,
    fontWeight: 600,
    fontSize: FONT_SIZE.body,
    color: COLORS.ink,
  },
  line: {
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.small,
    lineHeight: 1.4,
    color: COLORS.ink,
  },
})
