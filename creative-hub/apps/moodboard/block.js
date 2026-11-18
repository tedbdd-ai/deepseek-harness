// Moodboard: shows the clips and generations assigned to the idea; stores no data of its own.
export async function render(container, { idea, api, ui }) {
  const grid = ui.element('div', '', 'mood-grid')
  const picker = ui.element('select')
  picker.setAttribute('aria-label', 'Inspiration zur Idee hinzufügen')
  container.append(grid, picker)
  async function draw() {
    const [assigned, all] = await Promise.all([api('assets?project=' + idea.id), api('assets')])
    grid.replaceChildren(...(assigned.length ? assigned.map(asset => ui.assetTile(asset, () => api('unassign', 'POST', { id: asset.id, projectId: idea.id }).then(draw)))
      : [ui.element('p', 'Noch nichts zugeordnet. Wähle unten etwas aus deiner Inspiration oder Library.', 'empty')]))
    const ids = new Set(assigned.map(asset => asset.id))
    picker.replaceChildren(new Option('+ Aus Inspiration oder Library hinzufügen …', ''),
      ...all.filter(asset => !ids.has(asset.id)).map(asset => new Option(asset.title, asset.id)))
  }
  picker.onchange = async () => {
    if (!picker.value) return
    await api('assign', 'POST', { id: picker.value, projectId: idea.id })
    await draw()
  }
  await draw()
}
