/**
 * UI primitives shared across modules.
 *
 * This package intentionally stays small: tokens plus helpers. Module-specific
 * components live with their module until a second module needs them.
 */

/** Join class names, dropping falsy values. No dependency, no conflict merging. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}
