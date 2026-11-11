import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// TanStack Start -> Vite -> Nitro (node-server). The output is one Node process
// that can run on the LAN host next to Sage 50. See docs/adr/0002.
export default defineConfig({
  server: {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? 'localhost',
  },
  resolve: {
    tsconfigPaths: true,
  },
  // Argon2 is a native addon (.node binary). It must be required from
  // node_modules at runtime, not bundled into the server output.
  // `@react-pdf/renderer` uses package-internal `#standard-fonts/*` imports that
  // only resolve when Node loads it from node_modules. Keep it (and its
  // transitive font stack) out of the bundled server output.
  ssr: {
    external: ['@react-pdf/renderer', '@react-pdf/font', '@react-pdf/layout', '@react-pdf/pdfkit'],
  },
  plugins: [tanstackStart(), nitro({ preset: 'node-server' }), viteReact(), tailwindcss()],
})
