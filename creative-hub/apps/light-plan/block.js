// Lichtplan: data = { rows: [{ light, position, setting }], camera }
export function render(container, { data, save, ui }) {
  let state = { rows: Array.isArray(data.rows) ? data.rows : [], camera: typeof data.camera === 'string' ? data.camera : '' }
  const table = ui.rowsEditor({
    columns: [{ key: 'light', label: 'Licht', placeholder: '300W COB' }, { key: 'position', label: 'Position', placeholder: '45° links, 2 m' }, { key: 'setting', label: 'Einstellung', placeholder: '5600 K, 60 %, Magic Cloth' }],
    rows: state.rows,
    onChange: rows => { state = { ...state, rows }; save(state) },
  })
  const camera = ui.element('label', 'Kamera', 'field')
  const input = ui.element('input')
  input.value = state.camera
  input.placeholder = 'z. B. FX3, S-Log3, 35 mm, ISO 800'
  input.onchange = () => { state = { ...state, camera: input.value }; save(state) }
  camera.append(input)
  container.append(table, camera)
}
