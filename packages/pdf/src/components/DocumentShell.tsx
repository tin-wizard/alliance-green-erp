/** @jsxRuntime automatic */
/**
 * Page frame for every document: Letter portrait, fixed brand header, fixed
 * footer with page numbers, and a flow body that paginates normally.
 */
import type { ReactNode } from 'react'
import { Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { BrandHeader, type BrandHeaderMeta } from './BrandHeader'
import {
  BODY_BOTTOM,
  BODY_TOP,
  COLORS,
  FONT_BODY,
  FONT_SIZE,
  FOOTER_BOTTOM,
  FOOTER_HEIGHT,
  PAGE_MARGIN,
  PAGE_WIDTH,
} from '../theme'

export interface DocumentShellProps {
  readonly title: string
  readonly number: string
  readonly meta?: readonly BrandHeaderMeta[]
  /** Footer line on the left; the page number sits on the right. */
  readonly footerNote?: string
  readonly children: ReactNode
}

export function DocumentShell({
  title,
  number,
  meta,
  footerNote = 'Alliance Lighting',
  children,
}: DocumentShellProps) {
  return (
    <Page size="LETTER" orientation="portrait" style={styles.page}>
      <BrandHeader title={title} number={number} meta={meta} />

      <View style={styles.body}>{children}</View>

      <View style={styles.footer} fixed>
        <Text style={styles.footerText}>{footerNote}</Text>
        <Text
          style={styles.footerText}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </View>
    </Page>
  )
}

const styles = StyleSheet.create({
  page: {
    paddingTop: BODY_TOP,
    paddingBottom: BODY_BOTTOM,
    paddingHorizontal: PAGE_MARGIN,
    width: PAGE_WIDTH,
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.body,
    color: COLORS.ink,
    // No page-level lineHeight: an inherited numeric lineHeight stops the
    // dynamic page-number <Text render> from laying out at all. Line height is
    // set on the text primitives instead.
  },
  body: {
    width: '100%',
  },
  footer: {
    position: 'absolute',
    bottom: FOOTER_BOTTOM,
    left: PAGE_MARGIN,
    right: PAGE_MARGIN,
    height: FOOTER_HEIGHT,
    paddingTop: 6,
    borderTopWidth: 0.75,
    borderTopColor: COLORS.faintRule,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  footerText: {
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.micro,
    letterSpacing: 0.3,
    color: COLORS.muted,
  },
})
