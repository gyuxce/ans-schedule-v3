export type RemoteErrorKind = 'session' | 'permission' | 'other';

/** Reason written on sessions cancelled because their Class Master was cancelled. */
export const CLASS_CANCELLED_REASON = 'Class Master dibatalkan';

/**
 * Supabase errors read like "new row violates row-level security policy": the
 * write was refused, so what the screen shows is not what the database holds.
 * Tell an expired login apart from a role without the right.
 */
export function classifyRemoteError(
  message: string,
  hasSession: boolean
): { kind: RemoteErrorKind; text: string } {
  const lower = message.toLowerCase();
  const refused =
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('jwt') ||
    lower.includes('not authenticated');
  if (!refused) return { kind: 'other', text: message };
  if (!hasSession || lower.includes('jwt')) {
    return {
      kind: 'session',
      text: 'Sesi login habis, perubahan ini BELUM tersimpan di database. Login ulang lalu ulangi perubahannya.'
    };
  }
  return {
    kind: 'permission',
    text: 'Akun ini tidak punya hak menyimpan perubahan ini, jadi BELUM tersimpan di database. Pastikan memakai akun yang tepat (Super Admin untuk jadwal dan kelas), lalu muat ulang data.'
  };
}
