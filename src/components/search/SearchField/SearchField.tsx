import { useEffect, useId, useRef, useState } from 'react';
import type { Match } from '../../../search/match';
import styles from './SearchField.module.css';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Already scored and limited by the caller. */
  suggestions: Match[];
  /** A suggestion was chosen — from the list, or by pressing enter on it. */
  onPick: (match: Match) => void;
  /** Enter with nothing highlighted: search for whatever is typed. */
  onSubmit: () => void;
  placeholder?: string;
}

/**
 * The search box.
 *
 * Two things it does that a plain input would not.
 *
 * The suggestion list shows the *canonical* question, and underneath it the
 * phrasing that matched — so somebody who typed "why hasn't my refund hit"
 * can see they are being taken to "When will my financial aid refund arrive?"
 * and why. Silently rewriting what somebody typed is the thing that makes
 * grouped search feel like it is ignoring you.
 *
 * And it is a real combobox: arrow keys move through the list, enter takes
 * the highlighted one or searches for what was typed, escape closes it. A
 * suggestion list you can only reach with a mouse is one most people never
 * reach at all.
 */
export function SearchField({
  value,
  onChange,
  suggestions,
  onPick,
  onSubmit,
  // Short enough to survive a 390px field without being clipped mid-word.
  placeholder = 'Ask anything about your aid…',
}: SearchFieldProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const open = focused && suggestions.length > 0 && value.trim().length > 0;

  // A new set of suggestions is a new list; keeping the old index would leave
  // the highlight on a row that has moved or gone.
  useEffect(() => setHighlight(-1), [value]);

  function keyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setFocused(false);
      inputRef.current?.blur();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (open && highlight >= 0) onPick(suggestions[highlight]);
      else onSubmit();
      inputRef.current?.blur();
      return;
    }

    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (current + 1) % suggestions.length);
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={`${styles.field} ${focused ? styles.lit : ''}`}>
        <span className={styles.glyph} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="6.25" />
            <path d="M15.6 15.6 20 20" />
          </svg>
        </span>

        <input
          ref={inputRef}
          className={styles.input}
          type="search"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search financial aid questions"
          aria-activedescendant={
            open && highlight >= 0 ? `${listId}-${suggestions[highlight].question.id}` : undefined
          }
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          // Deferred so a click on a suggestion lands before the list closes.
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={keyDown}
        />

        {value.length > 0 && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear the search"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        )}
      </div>

      {open && (
        <ul className={styles.list} id={listId} role="listbox" aria-label="Suggestions">
          {suggestions.map((match, index) => (
            <li key={match.question.id}>
              <button
                type="button"
                id={`${listId}-${match.question.id}`}
                role="option"
                aria-selected={index === highlight}
                className={`${styles.option} ${index === highlight ? styles.optionOn : ''}`}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(match)}
              >
                <span className={styles.optionQuestion}>{match.question.question}</span>
                {match.matchedVariant && (
                  <span className={styles.optionVia}>
                    Also asked as &ldquo;{match.matchedVariant}&rdquo;
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
