/** Hub app "Lichtplan": Lichtquellen, Positionen und Kamera. */
import { defineApp } from '../define-app.mjs'

export const { name, inject, apply } = defineApp({
  id: 'light-plan',
  title: 'Lichtplan',
  icon: 'M9 18h6M10 21h4M8 14a4 4 0 1 1 8 0c0 2-2 3-2 4h-4c0-1-2-2-2-4z',
  description: 'Lichtquellen, Positionen und Kamera',
}, import.meta.url)
