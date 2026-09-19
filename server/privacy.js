// Deliberately conservative blocker; not a complete PII detector.
export const PRIVACY_MESSAGE = 'Please remove Social Security numbers, FSA login information, tax IDs, bank or account numbers, passwords and other sensitive information, then try again.';
export class PrivacyError extends Error { constructor(){super(PRIVACY_MESSAGE);this.name='PrivacyError';} }
export function containsHighRiskPII(value) {
  const text=String(value).normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'');
  return [
    /\b\d{3}[-\s.]\d{2}[-\s.]\d{4}\b/,
    /\b\d{9,17}\b/, // Includes unformatted SSN/routing/account/card numbers.
    /\b\d{2}[-\s]\d{7}\b/,
    /\b(?:ssn|social security|tax[ -]?(?:id|identification)|ein|itin)\b[^\n]{0,30}\d/i,
    /\b(?:bank|routing|account|acct|iban|swift)\s*(?:number|no\.?|#|id)?\s*(?:is|:|=|ending in)?\s*[A-Z0-9*Xx-]*\d[A-Z0-9*Xx -]{3,}/i,
    /\b(?:password|passphrase|passwd|pwd|login credentials?|fsa\s*(?:id|login|credentials?|username)|username|user\s*name|access token|api[ -]?key)\s*(?:is|are|:|=)\s*\S+/i,
    /\b(?:my|our)\s+(?:password|passphrase|fsa\s*(?:id|login)|username|login)\s+\S+/i,
    /\b(?:password|passwd|pwd)\s+(?!reset\b|requirements\b|help\b|security\b|manager\b)\S*[\d@!#$%]\S*/i,
    /\b(?:sk-|Bearer\s+)[A-Za-z0-9_-]{12,}/i,
    /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/i,
  ].some(pattern=>pattern.test(text));
}
export function assertSafeInput(input) {
  // Files/images cannot be inspected by a text-pattern blocker. Fail closed.
  if(typeof input !== 'string') throw new PrivacyError();
  if(containsHighRiskPII(input)) throw new PrivacyError();
}
