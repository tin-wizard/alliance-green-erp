// Prepare the server bundle's font assets and pdfkit standard-font data.
//
// `@cls/pdf` looks for `../fonts/` relative to its bundled module, which is
// `.output/server/fonts` in the node-server build. pdfkit (inside
// `@react-pdf/font`) also lazily `require`s `#standard-fonts/*`; Nitro bundles
// pdfkit into `_libs`, where that package-imports map no longer resolves. The
// generated package.json gives the bundle the same map and the .cjs faces are
// copied beside it. Fail the build instead of shipping a renderer that falls
// back or crashes at first use.
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(appDir, '../../packages/pdf/fonts')
const target = resolve(appDir, '.output/server/fonts')
const expected = [
  'InstrumentSans-Regular.ttf',
  'InstrumentSans-Medium.ttf',
  'InstrumentSans-SemiBold.ttf',
  'LibreCaslonText-Regular.ttf',
]

const missing = expected.filter((file) => !existsSync(join(source, file)))
if (missing.length > 0) {
  console.error(`copy-pdf-fonts: missing ${missing.join(', ')} in ${source}`)
  process.exit(1)
}
cpSync(source, target, { recursive: true })

const pdfkitMain = createRequire(join(appDir, 'package.json')).resolve('pdfkit')
const standardFonts = join(dirname(pdfkitMain), 'standard-fonts')
const serverRoot = resolve(appDir, '.output/server')
const fontsTarget = join(serverRoot, 'standard-fonts')
mkdirSync(fontsTarget, { recursive: true })
cpSync(standardFonts, fontsTarget, {
  recursive: true,
  filter: (file) => !file.endsWith('.mjs'),
})
writeFileSync(
  join(serverRoot, 'package.json'),
  `${JSON.stringify(
    {
      name: 'cls-web-server',
      private: true,
      type: 'module',
      imports: { '#standard-fonts/*': './standard-fonts/*.cjs' },
    },
    null,
    2,
  )}\n`,
)

const copied = readdirSync(target).filter((file) => file.endsWith('.ttf'))
if (copied.length < expected.length) {
  console.error(`copy-pdf-fonts: expected ${expected.length} faces, found ${copied.length}`)
  process.exit(1)
}
console.log(`copy-pdf-fonts: ${copied.length} faces + ${readdirSync(fontsTarget).length} standard fonts`)
