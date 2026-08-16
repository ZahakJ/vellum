// Limits both sides of the wire need to agree on. The upload cap lives here
// because the drop-zone hint states it in words ("10 MB max" / "بحد أقصى ١٠
// ميغابايت") — a hint that quoted its own hard-coded number could drift away
// from the cap the server actually enforces.

/** Largest image POST /api/upload accepts, in whole megabytes. */
export const UPLOAD_MAX_MB = 10;

/** The same cap in bytes (what the server checks). */
export const UPLOAD_MAX_BYTES = UPLOAD_MAX_MB * 1024 * 1024;

/** Largest FONT POST /api/fonts/upload accepts, in whole megabytes. Same
 *  reason as the image cap above: the Typography drop-zone states the number
 *  in words, and a hint that quoted its own constant would drift from the one
 *  the server enforces. */
export const FONT_UPLOAD_MAX_MB = 5;

/** The same cap in bytes (what server/customFonts.ts checks). */
export const FONT_UPLOAD_MAX_BYTES = FONT_UPLOAD_MAX_MB * 1024 * 1024;
