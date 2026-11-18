import React from 'react'
import { createRoot } from 'react-dom/client'
import { Excalidraw, exportToCanvas } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

export function mount(container, initialScene) {
  let scene = initialScene
  const root = createRoot(container)
  root.render(
    <Excalidraw
      initialData={{ ...initialScene, scrollToContent: true }}
      onChange={(elements, appState, files) => {
        scene = {
          elements,
          files,
          appState: { viewBackgroundColor: appState.viewBackgroundColor },
        }
      }}
    />,
  )
  return { scene: () => scene, unmount: () => root.unmount() }
}

export async function preview(scene) {
  const elements = scene.elements.filter(element => !element.isDeleted)
  if (!elements.length) {
    const empty = document.createElement('p')
    empty.textContent = 'Das Storyboard ist leer.'
    return empty
  }
  const canvas = await exportToCanvas({
    elements,
    files: scene.files,
    appState: { ...scene.appState, exportBackground: true },
    maxWidthOrHeight: 720,
  })
  const image = new Image()
  image.src = canvas.toDataURL()
  image.alt = 'Storyboard-Vorschau'
  return image
}
