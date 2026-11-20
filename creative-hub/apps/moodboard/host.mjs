/** Hub app "Moodboard": Bilder und Clips dieser Idee. */
import { defineApp } from '../define-app.mjs'

export const { name, inject, apply } = defineApp({
  id: 'moodboard', page: true,
  title: 'Moodboard',
  icon: 'M4 4h16v16H4zM4 14l5-5 5 5 2-2 4 4',
  description: 'Bilder und Clips dieser Idee',
}, import.meta.url)
