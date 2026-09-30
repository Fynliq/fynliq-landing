// Shape and size limits for redacted aid-line documents, shared by the
// document reader (/api/analyze) and the pending-analysis store
// (/api/billing). Only text pages are ever accepted: no file bytes.
export const MAX_DOCUMENTS = 3;
export const MAX_PAGES = 12;
export const MAX_CHARS = 30000;

/** Returns null when valid, or [status, message] describing the problem. */
export function documentsProblem(documents, { requireNames = true } = {}) {
  if (!Array.isArray(documents) || !documents.length || documents.length > MAX_DOCUMENTS) return [400, 'Upload 1–3 documents.'];
  let totalChars = 0;
  for (const doc of documents) {
    if (!doc || (requireNames && (typeof doc.name !== 'string' || doc.name.length > 180)) || !Array.isArray(doc.pages) ||
      !doc.pages.length || doc.pages.length > MAX_PAGES || !doc.pages.every((p) => typeof p === 'string')) {
      return [400, 'Invalid upload.'];
    }
    totalChars += doc.pages.reduce((sum, p) => sum + p.length, 0);
  }
  if (totalChars > MAX_CHARS) return [413, 'These documents are too long. Upload just the aid summary pages.'];
  return null;
}
