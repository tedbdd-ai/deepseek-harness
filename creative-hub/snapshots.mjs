/**
 * Default snapshots: templates that decide which apps a new idea starts with.
 * `creativity-core` uses them unless its `snapshots` config replaces them; the
 * MCP server reads the same list. An app id may name an app that is not
 * installed yet; the hub then offers to build it.
 */
export const defaultSnapshots = [
  { id: 'music', title: 'Musik-Session', color: '#F59E0B', description: 'Track, Jam oder Live-Set mit Gear und Patches.', apps: ['patch-sheet', 'checklist', 'flows'] },
  { id: 'fashion', title: 'Mode-Lookbook', color: '#EC4899', description: 'Outfits, Materialien und Looks.', apps: ['flows', 'checklist'] },
  { id: 'shoot', title: 'Shoot', color: '#EF4444', description: 'Foto- oder Video-Shoot mit Licht und Review.', apps: ['light-plan', 'flows', 'checklist', 'video-review'] },
  { id: 'vr', title: 'VR-Konzept', color: '#3B82F6', description: 'Räume und Szenen mit Skizzen und Referenzen.', apps: ['flows', 'vr-scene'] },
  { id: 'graphic', title: 'Grafik', color: '#14B8A6', description: 'Flyer, Cover und Thumbnails.', apps: ['flows'] },
  { id: 'blank', title: 'Leer', color: '#8E8E93', description: 'Nur Text und Board, Apps nach Bedarf.', apps: [] },
]
