/**
 * Try-on prompts of the Styler. The rules are condensed from Fit-Checker (`prompts/outfit.ts`
 * outfit-v7, `prompts/colorEdit.ts`), where each one fixed an observed failure: reference tattoos
 * transferred, invented sleeves, skin turned into latex, glossy read as tight, latex drawn as PVC,
 * translucent latex painted opaque. Raise `version` whenever a rule changes so results stay comparable.
 */
export const version = 'styler-outfit-v1'

/** Garment categories, inner to outer layer; `excludes` lists categories a piece replaces. */
export const categories = [
  { id: 'Einteiler', en: 'one-piece garment (catsuit, dress or overall)', excludes: ['Oberteil', 'Unterteil'] },
  { id: 'Unterteil', en: 'bottom (trousers, skirt or shorts)', excludes: ['Einteiler'] },
  { id: 'Oberteil', en: 'top', excludes: ['Einteiler'] },
  { id: 'Jacke oder Mantel', en: 'outer layer (jacket or coat)', excludes: [] },
  { id: 'Schuhe', en: 'footwear', excludes: [] },
  { id: 'Accessoire', en: 'accessory (gloves, hood, belt, jewellery or bag)', excludes: [] },
]

export const materials = {
  auto: { label: 'Wie im Bild', en: '' },
  latex: { label: 'Latex', en: 'real latex rubber' },
  'latex-transparent': { label: 'Latex, transparent', en: 'translucent latex rubber' },
  stoff: { label: 'Stoff', en: 'textile fabric' },
  leder: { label: 'Leder', en: 'leather' },
}

const latexLook = 'Latex is real latex rubber, not vinyl or PVC: a smooth, soft, slightly elastic surface that follows the body, with a wet-look sheen and soft, broad highlights along the curves. No stiff plastic look, no crinkled creases, no hard mirror reflections.'
const translucentLook = 'Translucent latex looks like tinted glass: a clear tinted film, not milky and not an opaque painted surface. Any opaque underlayer stays a separate garment and shows through as a clearly darker shape; seams, edges and doubled layers look deeper and more saturated. Never turn it into opaque paint or erase it to show the layer beneath.'

/** Studio reference from a person photo, adapted from Fit-Checker's buildModelPrompt. */
export const fashionReference = [
  'Create a photorealistic full-body fashion studio reference of @Bild1. Preserve the person’s identity, face, hair, skin markings, age and natural body proportions.',
  'Show the entire body from top of head to bare feet, including both hands, centered in an upright 9:16 frame with space above and below.',
  'Use a near-frontal catalog stance, shoulders relaxed, arms down with a small gap beside the waist, one foot slightly forward, neutral expression.',
  'Use a seamless light-gray studio backdrop and soft even light. Dress the person in a plain opaque matte-black sleeveless base outfit, with no logos, footwear or accessories.',
  'Return one photograph.',
].join('\n')

/**
 * Builds the try-on prompt. @Bild1 is the Fashion-Referenz; @Bild2… follow `pieces` in order.
 * @param {{ category: string, material: keyof typeof materials, note?: string }[]} pieces selected garments, inner to outer.
 * @returns {string} the prompt for the Playground (marks are mapped to image numbers there).
 */
export function tryOnPrompt(pieces) {
  const lines = [
    `Virtual try-on (${version}). Edit @Bild1. @Bild1 is the ONLY source for the person, face, hair, skin and skin markings, body proportions, pose, hands, camera, background and lighting; keep all of these exactly.`,
    ...pieces.map((piece, i) => {
      const category = categories.find(c => c.id === piece.category)
      const material = materials[piece.material]?.en
      return `@Bild${i + 2} supplies ONLY the ${category.en}: cut, sleeve length, hem, volume, colour, material, pattern and details${material ? `; render it as ${material}` : ''}${piece.note ? ` (${piece.note.slice(0, 200)})` : ''}. Ignore the person, skin, tattoos, pose and all other clothing in @Bild${i + 2}.`
    }),
    'Apply all selected pieces together in one image, inner layers first, outerwear on top. Replace only the clothing of the selected categories; keep everything else.',
    'Never transfer tattoos, body art, makeup or skin from a garment reference. Plain skin in @Bild1 stays plain wherever still visible; newly exposed skin uses the person’s own skin.',
    'The reference cuts decide where fabric exists. Never invent sleeves, gloves, leggings, collars or panels to connect layers, and never turn exposed skin into latex.',
    'Transfer proportions, not just colour and length: a cropped piece can be wide; glossy material does not mean a tight cut; a tight underlayer does not make a loose outer piece tight. Keep layers as separate surfaces with contact shadows. Let folds follow the pose of @Bild1, not the reference wearer’s pose.',
  ]
  if (pieces.some(p => p.material === 'latex' || p.material === 'latex-transparent')) lines.push(latexLook)
  if (pieces.some(p => p.material === 'latex-transparent')) lines.push(translucentLook)
  lines.push('Matte fabric stays matte. Do not invent logos, pockets or extra garments. Return only the final image.')
  return lines.join('\n')
}

/** Further views of a Fashion-Referenz: [title, aspect, prompt]. */
export const cards = {
  face: ['Gesichtskarte', '3:4', 'Create one head-and-shoulders portrait of @Bild1: face front-on, relaxed expression, even light, full hairline in frame.'],
  silhouette: ['Silhouettenkarte', '2:3', 'Create one full-body three-quarter studio view of @Bild1 that clearly shows the waist, hip and shoulder silhouette. Keep the body shape and proportions exactly and include the feet.'],
  turnaround: ['Vierfachansicht', '4:3', 'Create one clean 2×2 model reference sheet of @Bild1: front and left profile on top, back and right profile below, the entire body in each panel at identical scale and camera height, panels separate.'],
}
export const consistency = 'Keep the same person, face, hair, skin markings, body shape, base outfit, seamless backdrop and studio lighting. Return one image with no text.'
