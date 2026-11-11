/**
 * Page geometry and typography for every `@cls/pdf` document (ADR 0011).
 *
 * Letter portrait only: 612 x 792 pt, 48 pt margins, 516 pt content width and a
 * 24 pt footer. A4 is deliberately not used; the client prints on Letter stock.
 */

export const PAGE_WIDTH = 612
export const PAGE_HEIGHT = 792
export const PAGE_MARGIN = 48
/** 612 - (2 x 48) */
export const CONTENT_WIDTH = 516
export const FOOTER_HEIGHT = 24

/** Fixed shell header: top offset, reserved flow space and footer strip. */
export const HEADER_TOP = 36
export const HEADER_HEIGHT = 64
export const BODY_TOP = HEADER_TOP + HEADER_HEIGHT + 24
export const FOOTER_BOTTOM = 30
export const BODY_BOTTOM = FOOTER_BOTTOM + FOOTER_HEIGHT + 12

export const LETTER_PAGE = {
  size: 'LETTER',
  orientation: 'portrait',
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
  margin: PAGE_MARGIN,
  contentWidth: CONTENT_WIDTH,
  footerHeight: FOOTER_HEIGHT,
} as const

export type PageSpec = typeof LETTER_PAGE

export const FONT_BODY = 'Instrument Sans'
export const FONT_TITLE = 'Libre Caslon Text'

export const COLORS = {
  ink: '#141414',
  muted: '#5E5E5E',
  rule: '#B9B9B9',
  faintRule: '#DCDCDC',
  band: '#F3F2EE',
  white: '#FFFFFF',
} as const

export const FONT_SIZE = {
  body: 9,
  small: 8,
  micro: 7,
  title: 15,
} as const
