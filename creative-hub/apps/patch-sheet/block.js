// Patch-Sheet: data = { rows: [{ device, patch, notes }] }
export function render(container, { data, save, ui }) {
  container.append(ui.rowsEditor({
    columns: [{ key: 'device', label: 'Gerät', placeholder: 'Korg phase8' }, { key: 'patch', label: 'Preset / Patch', placeholder: 'Preset 12' }, { key: 'notes', label: 'Einstellung', placeholder: 'Decay kurz, Resonanz hoch' }],
    rows: Array.isArray(data.rows) ? data.rows : [],
    onChange: rows => save({ rows }),
  }))
}
