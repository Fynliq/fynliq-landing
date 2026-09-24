/**
 * What the upload accepts, and why it turns something away.
 *
 * Kept as pure functions over a plain descriptor rather than over `File`, so
 * the rules are testable without a DOM and the component stays a thin shell.
 * A real `File` satisfies `FileDescriptor` structurally, so callers pass one
 * straight through.
 */

export interface FileDescriptor {
  name: string;
  size: number;
  type: string;
}

/** Award documents run to a few pages, and students photograph them one page at a time. */
export const MAX_FILES = 3;
export const MAX_BYTES = 2800000;

/**
 * HEIC is on the list because that is what an iPhone produces by default. The
 * browser cannot preview it, so the interface says so rather than showing a
 * broken thumbnail.
 */
export const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'] as const;

/** The `accept` attribute. Extensions first: HEIC has no reliable MIME type. */
export const ACCEPT_ATTRIBUTE = `${ACCEPTED_EXTENSIONS.join(',')},application/pdf,image/png,image/jpeg,image/webp`;

export const ACCEPTED_SUMMARY = 'PDF, PNG, JPG or WEBP · up to 2.8 MB total · 3 files at most';

export type RejectionReason = 'type' | 'size' | 'empty' | 'duplicate' | 'count';

export interface Rejection {
  name: string;
  reason: RejectionReason;
  /** Plain English, addressed to the student, with the fix in it. */
  message: string;
}

export interface Triage<T extends FileDescriptor = FileDescriptor> {
  accepted: T[];
  rejected: Rejection[];
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/** `1.4 MB`. Whole KB under a megabyte, one decimal above it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isAccepted = (file: FileDescriptor): boolean =>
  (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name)) ||
  file.type === 'application/pdf' ||
  ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);

/**
 * Sorts an incoming batch into what is kept and what is refused.
 *
 * Every refusal comes back with the reason in words. A dropzone that silently
 * swallows the file a student just dragged in is the single most common way
 * this kind of interface wastes somebody's afternoon.
 */
export function triageFiles<T extends FileDescriptor>(existing: T[], incoming: T[]): Triage<T> {
  const accepted: T[] = [];
  const rejected: Rejection[] = [];
  const seen = new Set(existing.map((file) => `${file.name}:${file.size}`));

  for (const file of incoming) {
    const key = `${file.name}:${file.size}`;

    if (seen.has(key)) {
      rejected.push({
        name: file.name,
        reason: 'duplicate',
        message: `${file.name} is already on the list.`,
      });
      continue;
    }

    if (existing.length + accepted.length >= MAX_FILES) {
      rejected.push({
        name: file.name,
        reason: 'count',
        message: `${file.name} was not added — ${MAX_FILES} files is the limit. Remove one to make room.`,
      });
      continue;
    }

    if (!isAccepted(file)) {
      rejected.push({
        name: file.name,
        reason: 'type',
        message: `${file.name} is not a file type Fynliq can read. Upload a PDF, or a screenshot as PNG or JPG.`,
      });
      continue;
    }

    if (file.size === 0) {
      rejected.push({
        name: file.name,
        reason: 'empty',
        message: `${file.name} is empty. It may not have finished downloading from your portal.`,
      });
      continue;
    }

    if (existing.reduce((sum, f) => sum + f.size, 0) + accepted.reduce((sum, f) => sum + f.size, 0) + file.size > MAX_BYTES) {
      rejected.push({
        name: file.name,
        reason: 'size',
        message: `${file.name} exceeds the 2.8 MB total upload limit. Use a smaller PDF or clear screenshots.`,
      });
      continue;
    }

    seen.add(key);
    accepted.push(file);
  }

  return { accepted, rejected };
}
