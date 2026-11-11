/** @jsxRuntime automatic */
/** Tick list of notes and terms supplied by the owning module. */
import { StyleSheet, Text, View } from '@react-pdf/renderer'
import { COLORS, FONT_BODY, FONT_SIZE } from '../theme'

export interface NotesSection {
  readonly heading: string
  readonly lines: readonly string[]
}

export interface NotesProps {
  readonly sections: readonly NotesSection[]
}

export function Notes({ sections }: NotesProps) {
  const visible = sections.filter((section) => section.lines.length > 0)
  if (visible.length === 0) return null
  return (
    <View style={styles.wrapper}>
      {visible.map((section) => (
        <View key={section.heading} style={styles.section} minPresenceAhead={36}>
          <Text style={styles.heading}>{section.heading}</Text>
          {section.lines.map((line, index) => (
            <Text key={`${index}-${line}`} style={styles.line}>
              {line}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    marginTop: 18,
  },
  section: {
    marginBottom: 12,
  },
  heading: {
    fontFamily: FONT_BODY,
    fontWeight: 600,
    fontSize: FONT_SIZE.micro,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.ink,
    marginBottom: 3,
  },
  line: {
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.small,
    lineHeight: 1.45,
    color: COLORS.muted,
  },
})
