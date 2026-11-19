import { defineApp } from '../define-app.mjs'

export const { name, inject, apply } = defineApp({
  id: 'styler', title: 'Styler', page: true,
  icon: 'M4 4h16v16H4z',
  description: 'Kleidung an einer Person aus Sammlung oder Library anprobieren',
}, import.meta.url)
