import { cn } from '@blueprint/ui';
import { UploadCloud } from 'lucide-react';
import { useCallback, useRef, useState, type DragEvent } from 'react';

interface DropzoneProps {
  /** Called with every file the user selected (browse or drop). */
  onFiles: (files: File[]) => void;
  /** Disable the dropzone while a parse is in flight. */
  disabled?: boolean;
  /** Comma-separated list passed to `<input accept="…">`. */
  accept?: string;
  /** Optional id linking a `<label>` outside this component. */
  inputId?: string;
}

const DEFAULT_ACCEPT = '.tf,.tf.json,.tfstate,.tfstate.backup,.zip';

/**
 * Reusable file dropzone for the `/import` route.
 *
 * Accessibility notes:
 *   - The whole region is keyboard-reachable through the hidden `<input>`
 *     so screen-reader users get the native "Choose file" affordance.
 *   - Drag state is purely visual; `onFiles` only fires on `drop` or
 *     input change, never on hover. A user dragging a file across the
 *     window doesn't accidentally upload anything.
 *   - When `disabled`, drop events are ignored and the visual state stays
 *     muted so a user mid-parse can't double-submit.
 */
export function Dropzone({
  onFiles,
  disabled = false,
  accept = DEFAULT_ACCEPT,
  inputId = 'import-file-input',
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hovering, setHovering] = useState(false);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setHovering(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles],
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (disabled) return;
      setHovering(true);
    },
    [disabled],
  );

  return (
    <div
      role="presentation"
      onDragOver={handleDragOver}
      onDragLeave={() => setHovering(false)}
      onDrop={handleDrop}
      className={cn(
        'group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border/60 bg-card px-6 py-12 text-center transition-colors',
        hovering && !disabled && 'border-primary/50 bg-primary/5',
        disabled && 'opacity-60',
      )}
    >
      <UploadCloud
        className={cn(
          'h-10 w-10 text-muted-foreground transition-colors',
          hovering && !disabled && 'text-primary',
        )}
        aria-hidden
      />
      <div className="space-y-1">
        <label htmlFor={inputId} className="cursor-pointer text-sm font-medium text-foreground">
          <span className="text-primary underline-offset-2 hover:underline">Choose files</span> or
          drag and drop here
        </label>
        <p className="text-xs text-muted-foreground">
          Accepts <code className="rounded bg-muted px-1">.tf</code>,{' '}
          <code className="rounded bg-muted px-1">.tfstate</code> and{' '}
          <code className="rounded bg-muted px-1">.zip</code> archives. Up to 5 MB per file.
        </p>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = '';
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label="Upload Terraform files"
      />
    </div>
  );
}
