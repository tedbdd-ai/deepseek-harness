/** Hub app "Checkliste": Aufgaben und Materialien zum Abhaken. */
import { defineApp } from '../define-app.mjs'

export const { name, inject, apply } = defineApp({
  id: 'checklist',
  title: 'Checkliste',
  icon: 'M5 7l2 2 4-4M5 15l2 2 4-4M14 8h6M14 16h6',
  description: 'Aufgaben und Materialien zum Abhaken',
}, import.meta.url)
