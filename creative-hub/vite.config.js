import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

export default {
  base: '/creativity-hub/board-editor/',
  define: { 'process.env.IS_PREACT': 'false' },
  // Tailwind serves the Flows editor's React Flow UI and shadcn components (apps/flows/ui, see components.json).
  plugins: [tailwindcss()],
  // shadcn components use the automatic JSX runtime (no `import React`).
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./apps/flows/ui', import.meta.url)) } },
  build: {
    rollupOptions: {
      input: { board: 'web/board.jsx', flows: 'apps/flows/editor.jsx' },
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: 'assets/[name].js',
        assetFileNames: asset => asset.names.some(name => name.endsWith('.css'))
          ? 'assets/board.css'
          : 'assets/[name]-[hash][extname]',
      },
    },
    cssCodeSplit: false,
  },
}
