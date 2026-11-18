export default {
  base: '/creativity-hub/board-editor/',
  define: { 'process.env.IS_PREACT': 'false' },
  build: {
    rollupOptions: {
      input: 'web/board.jsx',
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: 'assets/board.js',
        assetFileNames: asset => asset.names.some(name => name.endsWith('.css'))
          ? 'assets/board.css'
          : 'assets/[name]-[hash][extname]',
      },
    },
    cssCodeSplit: false,
  },
}
