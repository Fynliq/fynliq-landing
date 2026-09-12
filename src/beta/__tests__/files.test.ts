import { describe, expect, it } from 'vitest';
import {
  MAX_BYTES,
  MAX_FILES,
  extensionOf,
  formatBytes,
  triageFiles,
  type FileDescriptor,
} from '../files';

const file = (name: string, size = 1_000, type = ''): FileDescriptor => ({ name, size, type });

describe('triageFiles', () => {
  it('accepts the formats a portal actually produces', () => {
    const { accepted, rejected } = triageFiles(
      [],
      [file('summary.pdf'), file('award.PNG'), file('page.heic'), file('scan.jpeg')],
    );

    expect(accepted).toHaveLength(4);
    expect(rejected).toHaveLength(0);
  });

  it('accepts an image whose name has no extension, on its MIME type', () => {
    const { accepted } = triageFiles([], [file('screenshot', 2_000, 'image/png')]);

    expect(accepted).toHaveLength(1);
  });

  it('turns away a file it cannot read, and says what to upload instead', () => {
    const { accepted, rejected } = triageFiles([], [file('aid.docx', 5_000)]);

    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toBe('type');
    expect(rejected[0].message).toContain('PDF');
  });

  it('turns away an empty file as a failed download, not a bad file', () => {
    const { rejected } = triageFiles([], [file('award.pdf', 0)]);

    expect(rejected[0].reason).toBe('empty');
    expect(rejected[0].message).toContain('finished downloading');
  });

  it('states the size and the limit when a file is too large', () => {
    const { rejected } = triageFiles([], [file('scan.pdf', MAX_BYTES + 1)]);

    expect(rejected[0].reason).toBe('size');
    expect(rejected[0].message).toContain('10.0 MB');
  });

  it('does not add the same file twice', () => {
    const existing = [file('award.pdf', 4_096)];
    const { accepted, rejected } = triageFiles(existing, [file('award.pdf', 4_096)]);

    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toBe('duplicate');
  });

  it('treats a same-named file of a different size as a different page', () => {
    const { accepted } = triageFiles([file('page.jpg', 1_000)], [file('page.jpg', 2_000)]);

    expect(accepted).toHaveLength(1);
  });

  it('counts what is already on the list against the limit', () => {
    const existing = Array.from({ length: MAX_FILES }, (_, i) => file(`page-${i}.pdf`));
    const { accepted, rejected } = triageFiles(existing, [file('one-more.pdf')]);

    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toBe('count');
  });

  it('stops at the limit part-way through a dropped batch', () => {
    const incoming = Array.from({ length: MAX_FILES + 2 }, (_, i) => file(`page-${i}.pdf`));
    const { accepted, rejected } = triageFiles([], incoming);

    expect(accepted).toHaveLength(MAX_FILES);
    expect(rejected).toHaveLength(2);
  });
});

describe('extensionOf', () => {
  it('lowercases, and handles a name with no dot', () => {
    expect(extensionOf('AWARD.PDF')).toBe('.pdf');
    expect(extensionOf('screenshot')).toBe('');
    expect(extensionOf('my.award.letter.png')).toBe('.png');
  });
});

describe('formatBytes', () => {
  it('reads the way a file listing does', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2_048)).toBe('2 KB');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
  });
});
