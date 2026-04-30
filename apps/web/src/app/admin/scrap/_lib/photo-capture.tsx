'use client';

/**
 * Reusable photo-capture block. Renders a section header, an Add
 * button that opens the device camera (mobile) or file picker
 * (desktop), and a thumbnail strip of currently-attached files
 * with per-thumbnail remove buttons.
 *
 * Used three times on the scrap-invoice page (ID, Client Photo,
 * Items). The parent owns the `files[]` state — this component is
 * purely presentational + a fileinput trigger.
 *
 * Mobile-camera trigger uses the HTML5 `capture` attribute. iOS and
 * Android both honor it without requiring the JS MediaDevices API,
 * which keeps this 100 lines instead of 500 and works on every
 * browser AGC operators use.
 */

import { useRef } from 'react';

export interface PendingPhoto {
  /** Local-only id used for React keys + remove. */
  id: string;
  file: File;
  /** Local object URL for thumbnail rendering. */
  preview: string;
}

interface Props {
  label: string;
  /** Subtitle/help text shown below the label. */
  help?: string;
  /** When true, the Add button only allows one file at a time. */
  single?: boolean;
  files: PendingPhoto[];
  onChange: (files: PendingPhoto[]) => void;
}

export function PhotoCapture({
  label,
  help,
  single = false,
  files,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function add(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const items: PendingPhoto[] = Array.from(picked).map((file) => ({
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2),
      file,
      preview: URL.createObjectURL(file),
    }));
    if (single) {
      // Replace any existing single-photo selection — most users
      // re-shoot if the first photo is bad rather than wanting both
      // copies on file. Free the prior preview URL so we don't leak.
      for (const f of files) URL.revokeObjectURL(f.preview);
      onChange(items.slice(0, 1));
    } else {
      onChange([...files, ...items]);
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(id: string) {
    const target = files.find((f) => f.id === id);
    if (target) URL.revokeObjectURL(target.preview);
    onChange(files.filter((f) => f.id !== id));
  }

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            {label}
          </h2>
          {help && <p className="mt-1 text-xs text-ink-400">{help}</p>}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-ink-50"
        >
          {files.length === 0
            ? '+ Take photo / upload'
            : single
              ? 'Replace'
              : '+ Add another'}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // capture="environment" pops the rear camera on mobile devices
        // (iOS + Android). On desktop the attribute is ignored and the
        // file picker opens normally — same input, no UA-sniffing.
        capture="environment"
        multiple={!single}
        onChange={(e) => add(e.target.files)}
        className="hidden"
      />
      {files.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {files.map((f) => (
            <PhotoThumb key={f.id} photo={f} onRemove={() => remove(f.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function PhotoThumb({
  photo,
  onRemove,
}: {
  photo: PendingPhoto;
  onRemove: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-md border border-ink-200 bg-ink-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.preview}
        alt={photo.file.name}
        className="aspect-square w-full object-cover"
      />
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        className="absolute right-1 top-1 rounded-full bg-white/90 px-2 py-0.5 text-xs text-red-700 shadow hover:bg-white"
      >
        ✕
      </button>
      <div className="px-2 py-1 text-[10px] text-ink-500 truncate" title={photo.file.name}>
        {photo.file.name}
      </div>
    </div>
  );
}
