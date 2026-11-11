# ADR 0008 — Theme seam and design-token adoption

- **Status:** Accepted; tokens adopted from the design agent
- **Date:** 2026-11-11
- **Owners:** Platform (seam), Design agent (token values)

## Context

The shell had to be built before the design agent published its token file, so the first version
used a documented placeholder. The design agent has since published:

- `design/tokens.css` (17,490 bytes, v1.0, 11 November 2026),
- `design/COMPONENT-INVENTORY.md`, `design/DECISIONS.md` and the mocks.

The seam had to prove that adoption requires no component edits.

## Decision

1. **`packages/ui/src/tokens.css` is the design agent's file, adopted verbatim.** It keeps its
   three layers:
   - layer 1 primitives (`--cls-*`, `--erp-neutral-*`) — never used by components;
   - layer 2 semantic roles (`--surface-*`, `--text-*`, `--border-*`, `--action-*`,
     `--status-*-fg/bg/bd`, `--viz-*`) — the only names components may use;
   - layer 3 component/density contracts (`--control-*`, `--table-*`, `--card-*`).
2. **`apps/web/src/styles/app.css` maps layer 2 to Tailwind utilities** with `@theme inline`
   (`--color-app: var(--surface-app)`, `--color-fg: var(--text-primary)`, …). It imports
   Tailwind first, then the token file, then the mapping.
3. **Components use only mapped utilities or `var(--status-<name>-fg/bg/bd)`.** Status chips use
   inline variables because the status name is dynamic. There are no hex values in component code.
4. **Density and dim theme are already supported** by the token file (`[data-density="compact"]`,
   `[data-theme="dim"]`). No code change is needed to opt in; the shell does not set either
   attribute yet.
5. **Updating tokens is a file replacement.** Replace `packages/ui/src/tokens.css`; add a mapping
   line only if a new semantic name appears. Components stay untouched.
6. **Fonts are tokens.** `--font-sans` (Instrument Sans), `--font-serif` (Libre Caslon Text) and
   `--font-serif-italic` (Instrument Serif) are defined. The font files are not bundled yet; the
   stacks fall back to system fonts until they are self-hosted for the LAN.

## Adoption result

- Replacing the placeholder changed the palette, typography scale, radii, shadows, status triples
  and layout constants without editing any route or shell component.
- The only application-side change was extending the `@theme inline` mapping (`--font-serif-italic`,
  full type scale, radius and shadow names) and removing duplicated base typography so the token
  file owns it. One override remains: `a { color: inherit }`, because the storefront token base
  colours every anchor brand red and the ERP shell styles links explicitly.
- `grep -rn "#[0-9a-fA-F]\{3,6\}" apps/web/src` finds no component colours (only the favicon).

## Consequences

- **Positive:** one source of truth for visual values; design changes are reviewable as a token
  diff.
- **Positive:** status colours are consistent by construction (every chip uses the fg/bg/bd triple).
- **Negative:** the token file carries storefront base rules (html/body/anchor). The ERP keeps a
  small unlayered override for anchors; future token versions should split “tokens” from
  “storefront base”.
- **Negative:** `--font-sans` names a font that is not yet bundled; the fallback is deliberate
  until the design agent supplies the font files.

## Verification

- Build and screenshots after the swap; no component file changed for the adoption.
- Contrast values are the design agent's, not recomputed here; the token file documents them.
