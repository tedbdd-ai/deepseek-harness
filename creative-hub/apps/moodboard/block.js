// Moodboard: opens the shared project board editor (see apps/storyboard/editor.jsx).
export async function render(container, context) {
  return context.openProjectBoard(container, context, 'moodboard')
}
