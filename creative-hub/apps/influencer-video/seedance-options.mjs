export const seedanceModes = [['text', 'Text zu Video'], ['frames', 'Startframe und optionaler Endframe'], ['references', 'Multimodale Referenzen']]
export const seedanceResolutions = ['720p', '480p']
export const seedanceAspects = ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
export const seedanceFormats = ['mp4', 'mov']
export const seedanceTasks = [['auto', 'Automatisch'], ['reference', 'Neues Video nach Vorlage'], ['edit', 'Referenzvideo bearbeiten'], ['extend', 'Referenzvideo verlängern']]
export const seedanceImages = ['image/jpeg', 'image/png', 'image/webp']
export const seedanceFrames = [...seedanceImages, 'image/gif']
export const referenceKinds = [
  ['image', 'Bild', seedanceImages, 10],
  ['video', 'Video', ['video/mp4', 'video/quicktime'], 5],
  ['audio', 'Audio', ['audio/mpeg', 'audio/wav'], 5],
]
export const seedancePromptLimit = 20480
export const seedanceUploadLimits = {
  'image/jpeg': 30_000_000, 'image/png': 30_000_000, 'image/webp': 30_000_000, 'image/gif': 30_000_000,
  'video/mp4': 200_000_000, 'video/quicktime': 200_000_000,
  'audio/mpeg': 15_000_000, 'audio/wav': 15_000_000,
}
