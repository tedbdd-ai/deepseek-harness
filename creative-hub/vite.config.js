export default {
  base: '/creativity-hub/board-editor/',
  define: { 'process.env.IS_PREACT': 'false' },
  build: {
    rollupOptions: {
      input: 'web/board.jsx',
      output: { entryFileNames: 'assets/board.js' },
    },
    cssCodeSplit: false,
  },
  plugins: [{
    name: 'board-stylesheet',
    generateBundle(_options, bundle) {
      for (const [name, asset] of Object.entries(bundle)) {
        if (asset.type !== 'asset' || !name.endsWith('.css')) continue
        delete bundle[name]
        asset.fileName = 'assets/board.css'
        bundle[asset.fileName] = asset
      }
    },
  }],
}
