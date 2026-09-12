import { useEffect, useId, useRef, useState } from 'react';
import { ACCEPTED_SUMMARY, ACCEPT_ATTRIBUTE, MAX_FILES, formatBytes } from '../../../beta/files';
import styles from './Dropzone.module.css';

interface DropzoneProps {
  files: File[];
  /** Handed the raw batch. Validation lives in `beta/files.ts`, not here. */
  onAdd: (incoming: File[]) => void;
  onRemove: (index: number) => void;
  /** True while an analysis is running, so the zone stops accepting files. */
  busy?: boolean;
}

function UploadGlyph() {
  return (
    <svg className={styles.glyph} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The upload target.
 *
 * One tab stop, not three: the zone is a real `<button>`, so Enter and Space
 * open the picker and the focus ring lands where the eye already is. Dragging
 * and pasting are additions on top of that, never the only way in.
 */
export function Dropzone({ files, onAdd, onRemove, busy = false }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pasted, setPasted] = useState(false);
  const hintId = useId();

  // dragenter and dragleave both fire as the pointer crosses child elements.
  // Counting them is the only reliable way to know when the pointer has really
  // left the zone rather than moved onto the text inside it.
  const depth = useRef(0);

  const full = files.length >= MAX_FILES;
  const locked = busy || full;

  useEffect(() => {
    if (busy) return;

    // A screenshot is the fastest thing a student can produce from a portal,
    // and on every OS it lands on the clipboard first.
    const onPaste = (event: ClipboardEvent) => {
      const incoming = Array.from(event.clipboardData?.files ?? []);
      if (incoming.length === 0) return;

      event.preventDefault();
      onAdd(incoming);
      setPasted(true);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [busy, onAdd]);

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={[styles.zone, dragging ? styles.over : '', locked ? styles.locked : '']
          .filter(Boolean)
          .join(' ')}
        onClick={() => inputRef.current?.click()}
        disabled={locked}
        aria-describedby={hintId}
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          // Without this the cursor shows "copy" on some platforms and "no
          // entry" on others over the very same element.
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          onAdd(Array.from(event.dataTransfer.files));
        }}
      >
        <UploadGlyph />
        <span className={styles.lead}>
          {full ? `That is ${MAX_FILES} files — the limit` : 'Drop your aid summary here'}
        </span>
        <span className={styles.or}>
          {full ? 'Remove one below to add another' : 'or choose a file from your device'}
        </span>
      </button>

      <p className={styles.hint} id={hintId}>
        {ACCEPTED_SUMMARY}. You can also paste a screenshot with{' '}
        <kbd className={styles.kbd}>Ctrl</kbd>
        <span aria-hidden="true"> / </span>
        <kbd className={styles.kbd}>⌘</kbd> <kbd className={styles.kbd}>V</kbd>.
        {pasted && <span className={styles.pasted}> Pasted.</span>}
      </p>

      <input
        ref={inputRef}
        className="srOnly"
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        tabIndex={-1}
        onChange={(event) => {
          onAdd(Array.from(event.target.files ?? []));
          // Cleared so re-picking the same file after a removal still fires.
          event.target.value = '';
        }}
      />

      {files.length > 0 && (
        <ul className={styles.files} aria-label="Files to analyse">
          {files.map((file, index) => (
            <li key={`${file.name}:${file.size}`} className={styles.file}>
              <span className={styles.fileMeta}>
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileSize}>{formatBytes(file.size)}</span>
              </span>
              <button
                type="button"
                className={styles.remove}
                onClick={() => onRemove(index)}
                disabled={busy}
              >
                Remove
                <span className="srOnly"> {file.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
