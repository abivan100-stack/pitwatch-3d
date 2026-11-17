import charsetRaw from '../assets/fonts/pdf/charset.txt?raw'

/**
 * Every character the shipped PDF font subset can draw, read from the same charset.txt the
 * subsetter was given, so the runtime guard and the font cannot drift apart. Line endings are
 * stripped in case an editor or git adds one to the file.
 */
export const PDF_CHARSET = charsetRaw.replace(/\r?\n/g, '')

const DRAWABLE = new Set(PDF_CHARSET)

/**
 * Text the embedded font can draw. Anything outside the subset becomes a visible '?', never
 * mojibake; decomposed accents are normalised first so 'e' + U+0301 prints as 'é'.
 */
export const pdfText = (text: string): string =>
  [...text.normalize('NFC')].map((c) => (DRAWABLE.has(c) ? c : '?')).join('')
