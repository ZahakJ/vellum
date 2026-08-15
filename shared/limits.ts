// Limits both sides of the wire need to agree on. The upload cap lives here
// because the drop-zone hint states it in words ("10 MB max" / "بحد أقصى ١٠
// ميغابايت") — a hint that quoted its own hard-coded number could drift away
// from the cap the server actually enforces.

/** Largest image POST /api/upload accepts, in whole megabytes. */
export const UPLOAD_MAX_MB = 10;

/** The same cap in bytes (what the server checks). */
export const UPLOAD_MAX_BYTES = UPLOAD_MAX_MB * 1024 * 1024;
