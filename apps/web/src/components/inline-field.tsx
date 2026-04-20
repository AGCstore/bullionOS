'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Click-to-edit text / number field used on the Catalog list rows (name,
 * weight, purity). One component keeps the save/cancel flow identical
 * across every column and avoids copy-pasted Enter/Esc handlers per row.
 *
 * Behavior:
 *   - Display mode: show the value with a dotted underline on hover so it's
 *     obviously clickable without adding visual noise to a dense table.
 *   - Edit mode: focused input + hidden submit. Enter commits, Esc cancels.
 *   - `onSave` is async — caller runs the PATCH + query invalidation. While
 *     it's in flight the input is disabled so a double-Enter can't fire
 *     the request twice.
 *   - `validate` is optional, synchronous. Return a string to block save.
 *   - `format` transforms the raw string for display only (e.g. "0.9999").
 */
export function InlineField({
  value,
  onSave,
  type = 'text',
  step,
  min,
  max,
  maxLength,
  placeholder,
  format,
  validate,
  ariaLabel,
  className = '',
  displayClassName = '',
  inputClassName = '',
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  type?: 'text' | 'number';
  step?: number | string;
  min?: number | string;
  max?: number | string;
  maxLength?: number;
  placeholder?: string;
  /** Formatter applied to the display text only; editing uses raw value. */
  format?: (v: string) => string;
  validate?: (v: string) => string | null;
  ariaLabel?: string;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync when the server value changes out from under us
  // (e.g. after a parallel tab saved the same row).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    const problem = validate?.(trimmed);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(value);
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={ariaLabel ? `Edit ${ariaLabel}` : 'Edit'}
        className={`group inline-flex items-center text-left ${className}`}
      >
        <span
          className={`border-b border-dotted border-transparent group-hover:border-ink-300 ${displayClassName}`}
        >
          {format ? format(value) : value}
        </span>
      </button>
    );
  }

  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <input
        ref={inputRef}
        type={type}
        step={step}
        min={min}
        max={max}
        maxLength={maxLength}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            cancel();
          }
        }}
        onBlur={() => {
          // Delay so a click on our explicit Save button wins over blur.
          setTimeout(() => {
            if (editing) commit();
          }, 120);
        }}
        disabled={busy}
        className={`input py-0.5 text-sm ${inputClassName}`}
      />
      {error && <span className="text-[10px] text-red-700">{error}</span>}
    </span>
  );
}
