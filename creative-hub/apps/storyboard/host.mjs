import { defineApp } from '../define-app.mjs'

export const { name, inject, apply } = defineApp({
  id: 'storyboard', title: 'Storyboard', page: true,
  description: 'Story, Einstellungen und Videoclips eines Projekts',
  icon: 'M3 4h18v16H3zM9 4v16M15 4v16',
}, import.meta.url)
