/**
 * Facets and starter vocabulary of the tag system.
 *
 * The facets are a protocol constant; the tags inside them are data (seeded once per
 * `VOCABULARY_VERSION`, then owned by the user). Synonyms are matched against titles, prompts
 * and Apple Vision labels, so they list English words as well.
 */

/**
 * Facets in display order.
 * `editable: false` facets are computed from metadata and cannot be edited by hand.
 */
export const FACETS = [
  { id: 'art', name: 'Art', editable: true },
  { id: 'motiv', name: 'Motiv', editable: true },
  { id: 'mode', name: 'Mode', editable: true },
  { id: 'ort', name: 'Ort', editable: true },
  { id: 'licht', name: 'Licht und Stimmung', editable: true },
  { id: 'kamera', name: 'Kamera', editable: true },
  { id: 'farbe', name: 'Farbe', editable: false },
  { id: 'quelle', name: 'Quelle', editable: false },
  { id: 'modell', name: 'Modell', editable: false },
  { id: 'frei', name: 'Freie Tags', editable: true },
]

/** Bump when `STARTER_VOCABULARY` gains entries; only entries added since the last seed are inserted. */
export const VOCABULARY_VERSION = 1

/** @type {Record<string, [name: string, ...synonyms: string[]][]>} */
export const STARTER_VOCABULARY = {
  art: [['Foto', 'photo', 'photograph'], ['Generiert', 'generated', 'ai image'], ['Video', 'clip', 'footage'],
    ['Screenshot', 'bildschirmfoto', 'screen shot'], ['Webseite', 'website', 'webpage'], ['Notiz', 'note', 'text'], ['Skizze', 'sketch', 'drawing']],
  motiv: [['Person', 'people', 'human', 'persona'], ['Porträt', 'portrait', 'headshot', 'selfie', 'gesicht'],
    ['Gruppe', 'group', 'crowd'], ['Ganzkörper', 'full body', 'full-body'], ['Detail', 'closeup detail'],
    ['Objekt', 'object', 'product', 'still life'], ['Tier', 'animal', 'pet']],
  mode: [['Outfit', 'clothing', 'fashion', 'garment', 'apparel', 'kleidung', 'wardrobe'], ['Latex', 'rubber', 'gummi'],
    ['Leder', 'leather'], ['Lack', 'pvc', 'vinyl'], ['Maske', 'mask'], ['Handschuhe', 'gloves'],
    ['Stiefel', 'boots', 'footwear'], ['Catsuit', 'bodysuit'], ['Mantel', 'coat', 'jacket', 'jacke'], ['Kleid', 'dress', 'gown']],
  ort: [['Location', 'drehort', 'kulisse'], ['Innen', 'interior', 'indoor', 'innenraum', 'room'], ['Außen', 'outdoor', 'outdoors', 'aussen'],
    ['Studio'], ['Architektur', 'architecture', 'building', 'facade', 'fassade'],
    ['Straße', 'street', 'alley', 'strasse'], ['Natur', 'nature', 'landscape', 'forest', 'beach', 'mountain'],
    ['Klinik', 'clinic', 'hospital', 'praxis']],
  licht: [['Neon'], ['Low-Key', 'low key', 'lowkey'], ['High-Key', 'high key', 'highkey'], ['Tageslicht', 'daylight'],
    ['Nacht', 'night'], ['Gegenlicht', 'backlight', 'backlit'], ['Analog', 'film grain', 'grainy', 'korn', 'analog film']],
  kamera: [['Totale', 'wide shot', 'long shot'], ['Halbnah', 'medium shot'], ['Nah', 'close-up', 'closeup', 'close up'],
    ['Detailaufnahme', 'extreme close-up', 'macro'], ['POV', 'point of view'], ['Vogelperspektive', 'birds eye', 'top down'],
    ['Froschperspektive', 'low angle', 'worms eye']],
  farbe: [],
  quelle: [['Instagram'], ['Pinterest'], ['X', 'twitter'], ['YouTube'], ['Web'], ['Playground'], ['Styler'], ['Video Playground'], ['Upload']],
  modell: [],
  frei: [],
}

/** Normalised lookup key of a tag name or synonym. */
export const tagKey = name => String(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE')

/** Mapping of the legacy flat tags (before facets) onto vocabulary entries `[facet, name]`. */
export const LEGACY_TAGS = {
  person: ['motiv', 'Person'],
  porträt: ['motiv', 'Porträt'],
  outfit: ['mode', 'Outfit'],
  location: ['ort', 'Location'],
  architektur: ['ort', 'Architektur'],
  natur: ['ort', 'Natur'],
  innenraum: ['ort', 'Innen'],
  screenshot: ['art', 'Screenshot'],
}
