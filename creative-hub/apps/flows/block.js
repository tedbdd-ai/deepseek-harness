/** Browser module of the Flows page: loads the canvas bundle built from `editor.jsx` and mounts it. */
export async function render(container, ctx) {
  const href = '/creativity-hub/board-editor/assets/board.css'
  if (!document.querySelector('link[data-storyboard]') && ![...document.styleSheets].some(sheet => sheet.href === location.origin + href)) {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href })
    link.dataset.storyboard = ''
    // Wait for the styles: they make the canvas full-height, and the first fit-to-view needs the final size.
    const loaded = new Promise(resolve => { link.onload = link.onerror = resolve })
    document.head.append(link)
    await loaded
  }
  container.classList.add('flow-page')
  const { mount } = await import('/creativity-hub/board-editor/assets/flows.js')
  if (container.isConnected) mount(container, ctx)
}
