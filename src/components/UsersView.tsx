import { useState } from 'react';
import { ROLE_COPY } from '../constants';
import { useDashboardStore } from '../store/useDashboardStore';
import type { AppRole, UserAccount, UserStatus } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ConfirmDelete } from './ui/ConfirmDelete';
import { Modal } from './ui/Modal';
import { PageIntro } from './ui/PageIntro';
import { PasswordField } from './ui/PasswordField';

export function UsersView() {
  const users = useDashboardStore((state) => state.users);
  const sensei = useDashboardStore((state) => state.sensei);
  const currentUser = useDashboardStore((state) => state.currentUser);
  const createUserLogin = useDashboardStore((state) => state.createUserLogin);
  const updateUser = useDashboardStore((state) => state.updateUser);
  const deleteUser = useDashboardStore((state) => state.deleteUser);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editUser, setEditUser] = useState<UserAccount | null>(null);
  const [editForm, setEditForm] = useState({
    role: 'Sensei' as AppRole,
    status: 'Approved' as UserStatus,
    senseiId: ''
  });

  const openEdit = (user: UserAccount) => {
    setEditUser(user);
    setEditForm({ role: user.role, status: user.status, senseiId: user.senseiId ?? '' });
  };

  const saveEdit = async () => {
    if (!editUser) return;
    setSaving(true);
    const ok = await updateUser(editUser.id, {
      role: editForm.role,
      status: editForm.status,
      senseiId: editForm.role === 'Sensei' ? editForm.senseiId || null : null
    });
    setSaving(false);
    if (ok) setEditUser(null);
  };
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    password2: '',
    role: 'Sensei' as AppRole,
    status: 'Approved' as UserStatus,
    senseiId: ''
  });

  const save = async () => {
    if (!form.email.trim() || !form.password) return;
    if (form.password !== form.password2) return;
    if (form.password.length < 6) return;
    setSaving(true);
    const ok = await createUserLogin({
      email: form.email,
      password: form.password,
      role: form.role,
      status: form.status,
      name: form.name || form.email.split('@')[0],
      senseiId: form.senseiId || undefined
    });
    setSaving(false);
    if (ok) {
      setOpen(false);
      setForm({
        name: '',
        email: '',
        password: '',
        password2: '',
        role: 'Sensei',
        status: 'Approved',
        senseiId: ''
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageIntro
        kicker="Pengguna"
        title="Akun login"
        actions={
          <Button tone="primary" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
            Buat akun
          </Button>
        }
      >
        Super Admin bisa membuat akun login (email + password) langsung dari sini. Portal siswa ditunda ke V4.
      </PageIntro>
      <div className="ui-card overflow-hidden">
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Peran</th>
                <th>Status</th>
                <th>Sensei terkait</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td className="text-ink-soft" colSpan={4}>
                    Belum ada akun login.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} onClick={() => openEdit(user)} className="cursor-pointer">
                    <td>
                      <div className="font-medium text-ink">{user.name}</div>
                      <div className="text-xs text-ink-soft">{user.email}</div>
                    </td>
                    <td className="text-ink-soft">{user.role}</td>
                    <td>
                      <Badge
                        tone={
                          user.status === 'Approved'
                            ? 'success'
                            : user.status === 'Pending'
                              ? 'gold'
                              : 'danger'
                        }
                      >
                        {user.status}
                      </Badge>
                    </td>
                    <td className="text-ink-soft">
                      {user.role === 'Sensei' && !user.senseiId ? (
                        <span className="text-danger">belum tertaut</span>
                      ) : (
                        (sensei.find((item) => item.id === user.senseiId)?.name ?? '—')
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {open ? (
        <Modal
          title="Pengguna baru + akun login"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Batal</Button>
              <Button
                tone="primary"
                disabled={
                  saving || !form.email.trim() || form.password.length < 6 || form.password !== form.password2
                }
                onClick={() => void save()}
              >
                {saving ? 'Membuat…' : 'Buat akun login'}
              </Button>
            </>
          }
        >
          <input
            className="ui-input"
            placeholder="Nama"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <input
            className="ui-input"
            placeholder="Email login"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
          <PasswordField
            value={form.password}
            onChange={(value) => setForm({ ...form, password: value })}
            placeholder="Password (min. 6)"
          />
          <PasswordField
            value={form.password2}
            onChange={(value) => setForm({ ...form, password2: value })}
            placeholder="Ulangi password"
          />
          {form.password && form.password !== form.password2 ? (
            <p className="text-xs font-semibold text-danger">Password tidak sama.</p>
          ) : null}
          <select
            className="ui-select"
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value as AppRole })}
          >
            {Object.keys(ROLE_COPY).map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
          <select
            className="ui-select"
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value as UserStatus })}
          >
            <option>Approved</option>
            <option>Pending</option>
            <option>Suspended</option>
          </select>
          <select
            className="ui-select"
            value={form.senseiId}
            onChange={(event) => setForm({ ...form, senseiId: event.target.value })}
          >
            <option value="">Tidak terkait Sensei</option>
            {sensei.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.email}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-soft">
            Untuk role Sensei, pilih Sensei terkait yang emailnya sama agar jadwal/workload tertaut.
          </p>
        </Modal>
      ) : null}

      {editUser ? (
        <Modal
          title={`Ubah akun · ${editUser.name}`}
          onClose={() => setEditUser(null)}
          footer={
            <>
              <Button onClick={() => setEditUser(null)}>Batal</Button>
              <Button tone="primary" disabled={saving} onClick={() => void saveEdit()}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </>
          }
        >
          <p className="text-xs text-ink-soft">{editUser.email}</p>
          <label className="block">
            <span className="ui-label">Peran</span>
            <select
              className="ui-select"
              value={editForm.role}
              onChange={(event) => setEditForm({ ...editForm, role: event.target.value as AppRole })}
            >
              {Object.keys(ROLE_COPY).map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="ui-label">Status</span>
            <select
              className="ui-select"
              value={editForm.status}
              onChange={(event) => setEditForm({ ...editForm, status: event.target.value as UserStatus })}
            >
              <option>Approved</option>
              <option>Pending</option>
              <option>Suspended</option>
            </select>
          </label>
          {editForm.role === 'Sensei' ? (
            <label className="block">
              <span className="ui-label">Tautkan ke Sensei</span>
              <select
                className="ui-select"
                value={editForm.senseiId}
                onChange={(event) => setEditForm({ ...editForm, senseiId: event.target.value })}
              >
                <option value="">Belum tertaut</option>
                {sensei.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.email}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-soft">
                Ini yang menghilangkan pesan &ldquo;Akun Sensei belum tertaut&rdquo; — set{' '}
                <code>profiles.sensei_id</code> ke Sensei yang benar.
              </span>
            </label>
          ) : null}

          {editUser.id !== currentUser?.id ? (
            <div className="mt-2 flex flex-col items-start gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-ink-soft">
                Hapus profil login. Untuk memblokir total, hapus juga user di Supabase Authentication.
              </span>
              <ConfirmDelete
                label="Hapus"
                confirmLabel="Hapus akun"
                message={`Hapus akun ${editUser.name}?`}
                onConfirm={async () => {
                  const ok = await deleteUser(editUser.id);
                  if (ok) setEditUser(null);
                }}
              />
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
