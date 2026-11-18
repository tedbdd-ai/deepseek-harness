/** Hub app "Patch-Sheet": Geräte, Presets und Einstellungen. */
import { defineApp } from '../define-app.mjs'

export const { name, inject, apply } = defineApp({
  id: 'patch-sheet',
  title: 'Patch-Sheet',
  icon: 'M6 4v16M12 4v16M18 4v16M4 9h4M10 14h4M16 8h4',
  description: 'Geräte, Presets und Einstellungen',
}, import.meta.url)
