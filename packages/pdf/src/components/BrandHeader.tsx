/** @jsxRuntime automatic */
/**
 * Alliance Lighting wordmark lockup plus the document title, number and dates.
 * Rendered as the fixed top strip of `DocumentShell`, so it repeats on every
 * page of a multi-page document.
 */
import { StyleSheet, Text, View } from '@react-pdf/renderer'
import { COLORS, FONT_BODY, FONT_SIZE, FONT_TITLE, HEADER_TOP, PAGE_MARGIN } from '../theme'

export interface BrandHeaderMeta {
  readonly label: string
  readonly value: string
}

export interface BrandHeaderProps {
  readonly title: string
  readonly number: string
  readonly meta?: readonly BrandHeaderMeta[]
  /** Set false only when the header is composed outside the shell. */
  readonly fixed?: boolean
}

export function BrandHeader({ title, number, meta = [], fixed = true }: BrandHeaderProps) {
  return (
    <View style={styles.header} fixed={fixed}>
      <View style={styles.lockup}>
        <Text style={styles.wordmarkTop}>ALLIANCE</Text>
        <Text style={styles.wordmarkBottom}>LIGHTING</Text>
        <View style={styles.lockupRule} />
      </View>

      <View style={styles.document}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.number}>{number}</Text>
        {meta.map((item) => (
          <View key={item.label} style={styles.metaRow}>
            <Text style={styles.metaLabel}>{item.label}</Text>
            <Text style={styles.metaValue}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: HEADER_TOP,
    left: PAGE_MARGIN,
    right: PAGE_MARGIN,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 8,
    borderBottomWidth: 0.75,
    borderBottomColor: COLORS.rule,
  },
  lockup: {
    width: 190,
  },
  wordmarkTop: {
    fontFamily: FONT_TITLE,
    fontSize: 15,
    lineHeight: 1.1,
    letterSpacing: 2.4,
    color: COLORS.ink,
  },
  wordmarkBottom: {
    fontFamily: FONT_BODY,
    fontWeight: 500,
    fontSize: 8,
    lineHeight: 1.4,
    letterSpacing: 3.6,
    color: COLORS.ink,
  },
  lockupRule: {
    marginTop: 6,
    width: 64,
    borderTopWidth: 0.75,
    borderTopColor: COLORS.ink,
  },
  document: {
    alignItems: 'flex-end',
  },
  title: {
    fontFamily: FONT_TITLE,
    fontSize: FONT_SIZE.title,
    lineHeight: 1.15,
    color: COLORS.ink,
  },
  number: {
    marginTop: 2,
    fontFamily: FONT_BODY,
    fontWeight: 600,
    fontSize: 10,
    lineHeight: 1.25,
    color: COLORS.ink,
  },
  metaRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  metaLabel: {
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.micro,
    letterSpacing: 0.6,
    color: COLORS.muted,
  },
  metaValue: {
    marginLeft: 8,
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.small,
    color: COLORS.ink,
  },
})
