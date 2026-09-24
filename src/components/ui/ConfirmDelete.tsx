import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from './Button';

/**
 * Quiet trigger + a centered confirm popup (own overlay, not squeezed into
 * whatever narrow flex slot the trigger sits in). Nothing is deleted on the
 * first click.
 */
export function ConfirmDelete({
  label = 'Hapus',
  confirmLabel = 'Ya, hapus permanen',
  message = 'Tindakan ini tidak bisa dibatalkan.',
  disabled = false,
  onConfirm
}: {
  label?: string;
  confirmLabel?: string;
  message?: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-field)] border border-danger/40 bg-danger-soft px-3.5 text-sm font-semibold text-danger transition-colors duration-150 hover:bg-danger hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 size={14} />
        {label}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-[var(--overlay)] backdrop-blur-[2px]"
            aria-label="Tutup"
            onClick={() => !busy && setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-lift)]">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
                <Trash2 size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{message}</p>
                <p className="mt-1 text-xs text-ink-soft">Tindakan ini tidak bisa dibatalkan.</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button className="h-9" disabled={busy} onClick={() => setOpen(false)}>
                Batal
              </Button>
              <Button
                tone="danger"
                className="h-9"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onConfirm();
                  } finally {
                    setBusy(false);
                    setOpen(false);
                  }
                }}
              >
                {busy ? 'Menghapus…' : confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
