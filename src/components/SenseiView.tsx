import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CLASS_LEVELS } from '../constants';
import { getOperationalLabels, jlptLevels, senseiDisplayName } from '../lib/labels';
import { timezoneAbbreviation, timezoneLabel, SENSEI_TIMEZONE_OPTIONS } from '../lib/timezone';
import { formatHours, formatPercent, getWorkloadMetrics } from '../lib/workload';
import { useDashboardStore, usePermissions } from '../store/useDashboardStore';
import type { Sensei, SenseiPrimaryStatus, SenseiTimezone } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Avatar } from './ui/Avatar';
import { ConfirmDelete } from './ui/ConfirmDelete';
import { DetailFields } from './ui/DetailFields';
import { FilterChips } from './ui/FilterChips';
import { Meter } from './ui/Meter';
import { Modal } from './ui/Modal';
import { PageIntro } from './ui/PageIntro';
import { PasswordField } from './ui/PasswordField';
import { WeekNav } from './ui/WeekNav';

const LABEL_TONE = {
  NEW: 'muted',
  UNASSIGNED: 'gold',
  CUTI: 'sky'
} as const;

const emptyForm = (): Omit<Sensei, 'id'> => ({
  name: '',
  displayName: '',
  email: '',
  phone: '',
  levels: [],
  primaryStatus: 'ACTIVE',
  joinDate: new Date().toISOString().slice(0, 10),
  timezone: 'Asia/Jakarta',
  notes: '',
  needsAttention: false,
  canTeachEnglish: false,
  canTeachKids: false
});

export function SenseiView() {
  const permissions = usePermissions();
  const sensei = useDashboardStore((state) => state.sensei);
  const users = useDashboardStore((state) => state.users);
  const schedules = useDashboardStore((state) => state.schedules);
  const classMasters = useDashboardStore((state) => state.classMasters);
  const availability = useDashboardStore((state) => state.availability);
  const leavePeriods = useDashboardStore((state) => state.leavePeriods);
  const weekAnchor = useDashboardStore((state) => state.weekAnchor);
  const setWeekAnchor = useDashboardStore((state) => state.setWeekAnchor);
  const overrideSenseiStatus = useDashboardStore((state) => state.overrideSenseiStatus);
  const deleteSensei = useDashboardStore((state) => state.deleteSensei);
  const updateSenseiTimezone = useDashboardStore((state) => state.updateSenseiTimezone);
  const upsertSensei = useDashboardStore((state) => state.upsertSensei);
  const updateSenseiLevels = useDashboardStore((state) => state.updateSenseiLevels);
  const updateSenseiAttention = useDashboardStore((state) => state.updateSenseiAttention);
  const updateSenseiCapabilities = useDashboardStore((state) => state.updateSenseiCapabilities);
  const setSenseiLeave = useDashboardStore((state) => state.setSenseiLeave);
  const createUserLogin = useDashboardStore((state) => state.createUserLogin);
  const currentUser = useDashboardStore((state) => state.currentUser);
  const weeklyHourTarget = useDashboardStore((state) => state.settings.weeklyHourTarget);
  const visible = permissions.canViewAllSensei
    ? sensei
    : sensei.filter((item) => item.id === currentUser?.senseiId);
  const canEditOps = permissions.canManageUsers;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState(emptyForm());
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginPassword2, setLoginPassword2] = useState('');
  const [creatingLogin, setCreatingLogin] = useState(false);
  const [detailMode, setDetailMode] = useState<'view' | 'edit'>('view');
  const [filter, setFilter] = useState<
    'all' | 'unassigned' | 'new' | 'below_target' | 'n2' | 'n3' | 'english' | 'kids'
  >('all');
  const [levelsDraft, setLevelsDraft] = useState('');
  const [savingLevels, setSavingLevels] = useState(false);
  const selected = visible.find((item) => item.id === selectedId);
  const selectedLeave = useMemo(
    () => leavePeriods.find((item) => item.senseiId === selectedId && item.status === 'approved'),
    [leavePeriods, selectedId]
  );
  const hasLogin = useMemo(() => {
    const email = (creating ? form.email : selected?.email || form.email).trim().toLowerCase();
    if (!email) return false;
    return users.some((user) => user.email.trim().toLowerCase() === email);
  }, [users, creating, form.email, selected?.email]);

  const openCreate = () => {
    setCreating(true);
    setSelectedId(null);
    setDetailMode('edit');
    setForm(emptyForm());
    setReason('');
    setLoginPassword('');
    setLoginPassword2('');
  };

  const openDetail = (item: Sensei) => {
    setCreating(false);
    setSelectedId(item.id);
    setDetailMode('view');
    setReason('');
    setLoginPassword('');
    setLoginPassword2('');
    setLevelsDraft(item.levels.join(', '));
    setForm({
      name: item.name,
      displayName: item.displayName || '',
      email: item.email,
      phone: item.phone,
      levels: item.levels,
      primaryStatus: item.primaryStatus,
      joinDate: item.joinDate,
      timezone: item.timezone,
      notes: item.notes || '',
      needsAttention: item.needsAttention,
      canTeachEnglish: item.canTeachEnglish,
      canTeachKids: item.canTeachKids
    });
    const leave = leavePeriods.find((row) => row.senseiId === item.id && row.status === 'approved');
    setLeaveStart(leave?.startDate || '');
    setLeaveEnd(leave?.endDate || '');
  };

  const saveSensei = async () => {
    if (loginPassword) {
      if (loginPassword.length < 6) {
        toast.error('Password login minimal 6 karakter');
        return;
      }
      if (loginPassword !== loginPassword2) {
        toast.error('Password tidak sama');
        return;
      }
    }

    const id = upsertSensei({
      ...form,
      id: creating ? undefined : selectedId || undefined,
      displayName: form.displayName || undefined,
      notes: form.notes || undefined
    });
    if (!id) return;

    if (loginPassword) {
      setCreatingLogin(true);
      await createUserLogin({
        email: form.email,
        password: loginPassword,
        role: 'Sensei',
        status: 'Approved',
        name: form.name,
        senseiId: id
      });
      setCreatingLogin(false);
      setLoginPassword('');
      setLoginPassword2('');
    }

    setCreating(false);
    setSelectedId(id);
    setDetailMode('view');
  };

  const createLoginOnly = async () => {
    if (!selected && !form.email) return;
    if (loginPassword.length < 6) {
      toast.error('Password login minimal 6 karakter');
      return;
    }
    if (loginPassword !== loginPassword2) {
      toast.error('Password tidak sama');
      return;
    }
    const email = (selected?.email || form.email).trim();
    const senseiId = selected?.id;
    setCreatingLogin(true);
    await createUserLogin({
      email,
      password: loginPassword,
      role: 'Sensei',
      status: 'Approved',
      name: selected?.name || form.name,
      senseiId
    });
    setCreatingLogin(false);
    setLoginPassword('');
    setLoginPassword2('');
  };

  const saveLevelsOnly = () => {
    if (!selected) return;
    setSavingLevels(true);
    updateSenseiLevels(
      selected.id,
      levelsDraft
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    );
    setSavingLevels(false);
  };

  const roster = useMemo(() => {
    const rows = visible.map((item) => {
      const labels = getOperationalLabels(item, schedules, leavePeriods, new Date(), classMasters);
      const workload = getWorkloadMetrics(item.id, availability, schedules, weekAnchor, weeklyHourTarget);
      const linked = users.some(
        (user) => user.email.trim().toLowerCase() === item.email.trim().toLowerCase()
      );
      return { item, labels, workload, linked };
    });
    const filtered = rows.filter(({ item, labels, workload }) => {
      if (filter === 'unassigned') return labels.includes('UNASSIGNED');
      if (filter === 'new') return labels.includes('NEW');
      if (filter === 'below_target')
        return item.primaryStatus === 'ACTIVE' && workload.assignedHours < workload.targetHours;
      // Capability counts (JLPT level, English, Kids) only make sense for
      // Sensei actually available to teach, so INACTIVE is excluded here —
      // same principle the team asked for on N2/N3, applied consistently.
      if (filter === 'n2') return item.primaryStatus === 'ACTIVE' && jlptLevels(item.levels).includes('N2');
      if (filter === 'n3') return item.primaryStatus === 'ACTIVE' && jlptLevels(item.levels).includes('N3');
      if (filter === 'english') return item.primaryStatus === 'ACTIVE' && item.canTeachEnglish;
      if (filter === 'kids') return item.primaryStatus === 'ACTIVE' && item.canTeachKids;
      return true;
    });
    return filtered.sort((a, b) => {
      const aScore = a.labels.includes('UNASSIGNED') ? 0 : a.labels.includes('NEW') ? 1 : 2;
      const bScore = b.labels.includes('UNASSIGNED') ? 0 : b.labels.includes('NEW') ? 1 : 2;
      if (aScore !== bScore) return aScore - bScore;
      return senseiDisplayName(a.item).localeCompare(senseiDisplayName(b.item));
    });
  }, [
    visible,
    schedules,
    leavePeriods,
    classMasters,
    availability,
    weekAnchor,
    weeklyHourTarget,
    users,
    filter
  ]);

  const groups = useMemo(() => {
    if (filter !== 'all') return [{ key: 'flat', label: '', rows: roster }];
    // INACTIVE always sorts to its own group at the bottom, regardless of any
    // other label — otherwise it alphabetically interleaves with ACTIVE Sensei
    // in "Bertugas" and clutters the list.
    const activeRows = roster.filter((row) => row.item.primaryStatus === 'ACTIVE');
    const inactiveRows = roster.filter((row) => row.item.primaryStatus !== 'ACTIVE');
    // Need Attention (manually flagged by Kyouiku) takes priority over the
    // auto-computed UNASSIGNED/NEW labels — a compliance issue is more urgent
    // to surface than capacity bookkeeping, so a flagged Sensei shows in only
    // this one group even if they'd otherwise also be UNASSIGNED or NEW.
    const attentionRows = activeRows.filter((row) => row.item.needsAttention);
    const remainingActiveRows = activeRows.filter((row) => !row.item.needsAttention);
    const unassignedRows = remainingActiveRows.filter((row) => row.labels.includes('UNASSIGNED'));
    const newRows = remainingActiveRows.filter(
      (row) => !row.labels.includes('UNASSIGNED') && row.labels.includes('NEW')
    );
    const assignedRows = remainingActiveRows.filter(
      (row) => !row.labels.includes('UNASSIGNED') && !row.labels.includes('NEW')
    );
    return [
      { key: 'attention', label: 'Perlu perhatian', rows: attentionRows },
      { key: 'unassigned', label: 'Perlu ditugaskan', rows: unassignedRows },
      { key: 'new', label: 'Baru — sudah bertugas', rows: newRows },
      { key: 'assigned', label: 'Bertugas', rows: assignedRows },
      { key: 'inactive', label: 'Nonaktif', rows: inactiveRows }
    ].filter((group) => group.rows.length);
  }, [roster, filter]);

  return (
    <div className="space-y-6">
      <PageIntro
        kicker="Sensei"
        title="Master Sensei"
        actions={
          <>
            <WeekNav weekAnchor={weekAnchor} onChange={setWeekAnchor} />
            {canEditOps ? (
              <Button tone="primary" className="w-full sm:w-auto" onClick={openCreate}>
                + Tambah Sensei
              </Button>
            ) : null}
          </>
        }
      >
        Master data Sensei. Label NEW / UNASSIGNED / CUTI dihitung otomatis. Need Attention ditandai manual
        oleh Kyouiku. INACTIVE tetap tersimpan di history.
      </PageIntro>
      <p className="text-xs text-ink-soft">
        {visible.filter((item) => item.primaryStatus === 'ACTIVE').length} aktif ·{' '}
        {visible.filter((item) => item.primaryStatus !== 'ACTIVE').length} nonaktif · {visible.length} total
      </p>
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'all', label: 'Semua', count: visible.length },
          {
            id: 'unassigned',
            label: 'UNASSIGNED',
            count: visible.filter((item) =>
              getOperationalLabels(item, schedules, leavePeriods, new Date(), classMasters).includes(
                'UNASSIGNED'
              )
            ).length
          },
          {
            id: 'new',
            label: 'NEW',
            count: visible.filter((item) =>
              getOperationalLabels(item, schedules, leavePeriods, new Date(), classMasters).includes('NEW')
            ).length
          },
          { id: 'below_target', label: `Di bawah ${weeklyHourTarget} jam` },
          {
            id: 'n2',
            label: 'N2',
            count: visible.filter(
              (item) => item.primaryStatus === 'ACTIVE' && jlptLevels(item.levels).includes('N2')
            ).length
          },
          {
            id: 'n3',
            label: 'N3',
            count: visible.filter(
              (item) => item.primaryStatus === 'ACTIVE' && jlptLevels(item.levels).includes('N3')
            ).length
          },
          {
            id: 'english',
            label: 'Bisa Inggris',
            count: visible.filter((item) => item.primaryStatus === 'ACTIVE' && item.canTeachEnglish).length
          },
          {
            id: 'kids',
            label: 'Bisa Kids',
            count: visible.filter((item) => item.primaryStatus === 'ACTIVE' && item.canTeachKids).length
          }
        ]}
      />
      <div className="ui-card overflow-hidden">
        {roster.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">Tidak ada Sensei pada filter ini.</p>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              {group.label ? (
                <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {group.label}
                  <span className="text-ink-faint">{group.rows.length}</span>
                </div>
              ) : null}
              <div className="divide-y divide-line">
                {group.rows.map(({ item, labels, workload, linked }) => {
                  const ratio = workload.targetHours > 0 ? workload.assignedHours / workload.targetHours : 0;
                  const extraLabels = labels.filter(
                    (label) =>
                      !(group.key === 'unassigned' && label === 'UNASSIGNED') &&
                      !(group.key === 'new' && label === 'NEW')
                  );
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                      onClick={() => openDetail(item)}
                    >
                      <Avatar name={senseiDisplayName(item)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate font-semibold text-ink">{senseiDisplayName(item)}</span>
                          {jlptLevels(item.levels).map((level) => (
                            <Badge key={level} tone="muted">
                              {level}
                            </Badge>
                          ))}
                          {timezoneAbbreviation(item.timezone) !== 'WIB' ? (
                            <span className="text-[11px] font-medium text-ink-soft">
                              {timezoneAbbreviation(item.timezone)}
                            </span>
                          ) : null}
                          {!linked ? <span className="text-[11px] text-ink-faint">belum login</span> : null}
                          {item.primaryStatus !== 'ACTIVE' ? <Badge tone="danger">INACTIVE</Badge> : null}
                          {item.needsAttention ? <Badge tone="danger">NEED ATTENTION</Badge> : null}
                          {extraLabels.map((label) => (
                            <Badge key={label} tone={LABEL_TONE[label]}>
                              {label}
                            </Badge>
                          ))}
                        </div>
                        <p className="truncate text-xs text-ink-soft">{item.email || '—'}</p>
                        <div className="mt-2 flex items-center gap-3">
                          <Meter value={ratio} tone={ratio < 0.5 ? 'gold' : 'maple'} className="max-w-xs" />
                          <span className="shrink-0 text-xs font-semibold text-ink">
                            {formatHours(workload.assignedHours)} / {formatHours(workload.targetHours)}
                          </span>
                          <span className="hidden text-xs text-ink-soft sm:inline">
                            sisa {formatHours(workload.remainingHours)} ·{' '}
                            {formatPercent(workload.utilization)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {creating || selected ? (
        <Modal
          wide
          title={creating ? 'Tambah Sensei' : senseiDisplayName(selected!)}
          onClose={() => {
            setCreating(false);
            setSelectedId(null);
            setDetailMode('view');
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setCreating(false);
                  setSelectedId(null);
                  setDetailMode('view');
                }}
              >
                Tutup
              </Button>
              {!creating && selected && detailMode === 'view' && canEditOps ? (
                <Button tone="primary" onClick={() => setDetailMode('edit')}>
                  Ubah
                </Button>
              ) : null}
              {(creating || detailMode === 'edit') && canEditOps ? (
                <>
                  {!creating && selected && detailMode === 'edit' ? (
                    <Button onClick={() => openDetail(selected)}>Batal ubah</Button>
                  ) : null}
                  <Button tone="primary" onClick={() => void saveSensei()} disabled={creatingLogin}>
                    {creatingLogin ? 'Menyimpan…' : 'Simpan'}
                  </Button>
                </>
              ) : null}
            </>
          }
        >
          {!creating && selected && detailMode === 'view' ? (
            <>
              <DetailFields
                items={[
                  { label: 'Nama lengkap', value: selected.name },
                  { label: 'Display name', value: selected.displayName || selected.name },
                  { label: 'Email / login', value: selected.email || '—' },
                  { label: 'WhatsApp / kontak', value: selected.phone || '—' },
                  { label: 'Join date', value: selected.joinDate },
                  { label: 'Timezone', value: timezoneLabel(selected.timezone) },
                  { label: 'Primary status', value: selected.primaryStatus },
                  {
                    label: 'Akun login',
                    value: hasLogin ? 'Sudah ada' : 'Belum dibuat'
                  },
                  {
                    label: 'Level mengajar',
                    value: selected.levels.join(', ') || '—',
                    full: true
                  },
                  {
                    label: 'Catatan internal',
                    value: selected.notes || '—',
                    full: true
                  },
                  ...(selectedLeave
                    ? [
                        {
                          label: 'Periode CUTI',
                          value: `${selectedLeave.startDate} → ${selectedLeave.endDate}`,
                          full: true as const
                        }
                      ]
                    : [])
                ]}
              />
              {permissions.canEditSenseiLevels && !canEditOps ? (
                <label className="mt-3 block">
                  <span className="ui-label">Level mengajar (pisahkan koma)</span>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="ui-input flex-1"
                      value={levelsDraft}
                      onChange={(e) => setLevelsDraft(e.target.value)}
                      placeholder={CLASS_LEVELS.slice(0, 4).join(', ')}
                    />
                    <Button tone="primary" disabled={savingLevels} onClick={saveLevelsOnly}>
                      Simpan level
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    Kyouiku bisa mengubah level mengajar Sensei di sini. Data profil lain (nama, email, CUTI,
                    status, akun login) tetap hanya bisa diubah Super Admin.
                  </p>
                </label>
              ) : null}
              {permissions.canFlagSenseiAttention && selected.primaryStatus === 'ACTIVE' ? (
                <label className="mt-3 flex items-center gap-2 rounded-xl border border-line p-3">
                  <input
                    type="checkbox"
                    checked={selected.needsAttention}
                    onChange={(e) => updateSenseiAttention(selected.id, e.target.checked)}
                  />
                  <span>
                    <span className="ui-label block">Need Attention</span>
                    <span className="text-xs text-ink-soft">
                      Sensei aktif tier bawah yang compliance-nya perlu ditindaklanjuti. Ditandai manual oleh
                      Kyouiku.
                    </span>
                  </span>
                </label>
              ) : null}
              {permissions.canEditSenseiLevels ? (
                <div className="mt-3 rounded-xl border border-line p-3">
                  <span className="ui-label block">Kemampuan mengajar</span>
                  <span className="text-xs text-ink-soft">
                    Diisi Kyouiku/Ops saat Sensei pertama kali dibuatkan akun, supaya kelihatan cepat di
                    Ketersediaan tanpa buka halaman ini.
                  </span>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.canTeachEnglish}
                        onChange={(e) =>
                          updateSenseiCapabilities(selected.id, {
                            canTeachEnglish: e.target.checked,
                            canTeachKids: selected.canTeachKids
                          })
                        }
                      />
                      Bisa Inggris
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.canTeachKids}
                        onChange={(e) =>
                          updateSenseiCapabilities(selected.id, {
                            canTeachEnglish: selected.canTeachEnglish,
                            canTeachKids: e.target.checked
                          })
                        }
                      />
                      Bisa Kids
                    </label>
                  </div>
                </div>
              ) : null}
            </>
          ) : canEditOps ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label>
                <span className="ui-label">Nama lengkap</span>
                <input
                  className="ui-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                <span className="ui-label">Display name</span>
                <input
                  className="ui-input"
                  value={form.displayName || ''}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                />
              </label>
              <label>
                <span className="ui-label">Email / login</span>
                <input
                  className="ui-input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label>
                <span className="ui-label">WhatsApp / kontak</span>
                <input
                  className="ui-input"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <label>
                <span className="ui-label">Join date</span>
                <input
                  className="ui-input"
                  type="date"
                  value={form.joinDate}
                  onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
                />
              </label>
              <label>
                <span className="ui-label">Timezone</span>
                <select
                  className="ui-select"
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value as SenseiTimezone })}
                >
                  {SENSEI_TIMEZONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.abbreviation} · {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="ui-label">Primary status</span>
                <select
                  className="ui-select"
                  value={form.primaryStatus}
                  onChange={(e) => setForm({ ...form, primaryStatus: e.target.value as SenseiPrimaryStatus })}
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </label>
              <label className="md:col-span-2">
                <span className="ui-label">Level mengajar (pisahkan koma)</span>
                <input
                  className="ui-input"
                  value={form.levels.join(', ')}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      levels: e.target.value
                        .split(',')
                        .map((item) => item.trim())
                        .filter(Boolean)
                    })
                  }
                  placeholder={CLASS_LEVELS.slice(0, 4).join(', ')}
                />
              </label>
              <label className="md:col-span-2">
                <span className="ui-label">Catatan internal</span>
                <textarea
                  className="ui-textarea"
                  value={form.notes || ''}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-1 text-sm text-ink-soft">
              <p>Level: {selected?.levels.join(', ') || '—'}</p>
              <p>Timezone: {selected ? timezoneLabel(selected.timezone) : '—'}</p>
              {selected?.notes ? <p>{selected.notes}</p> : null}
            </div>
          )}

          {(creating || detailMode === 'edit') && canEditOps ? (
            <div className="mt-3 space-y-2 rounded-xl border border-info/25 bg-info-soft p-3">
              <p className="ui-label">Akun login dashboard</p>
              {hasLogin ? (
                <p className="text-sm text-ink-soft">
                  Email ini sudah punya profil login. Sensei bisa masuk dengan password yang sudah diset.
                  Reset password lewat Supabase Authentication bila lupa.
                </p>
              ) : (
                <>
                  <p className="text-xs text-ink-soft">
                    Isi password di bawah untuk membuat akun login langsung dari dashboard (role Sensei,
                    status Approved). Email login = email Sensei di atas.
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <label>
                      <span className="ui-label">Password login</span>
                      <PasswordField
                        value={loginPassword}
                        onChange={setLoginPassword}
                        placeholder="Minimal 6 karakter"
                      />
                    </label>
                    <label>
                      <span className="ui-label">Ulangi password</span>
                      <PasswordField value={loginPassword2} onChange={setLoginPassword2} />
                    </label>
                  </div>
                  {loginPassword && loginPassword !== loginPassword2 ? (
                    <p className="text-xs font-semibold text-danger">Password tidak sama.</p>
                  ) : null}
                  {!creating && selected ? (
                    <Button
                      tone="primary"
                      disabled={
                        creatingLogin ||
                        loginPassword.length < 6 ||
                        loginPassword !== loginPassword2 ||
                        !form.email
                      }
                      onClick={() => void createLoginOnly()}
                    >
                      {creatingLogin ? 'Membuat…' : 'Buat akun login sekarang'}
                    </Button>
                  ) : (
                    <p className="text-xs text-ink-soft">
                      Saat Simpan, master Sensei + akun login dibuat bersamaan jika password diisi.
                    </p>
                  )}
                </>
              )}
            </div>
          ) : null}

          {!creating && selected && detailMode === 'edit' && canEditOps ? (
            <div className="mt-3 space-y-3">
              <div className="space-y-2 rounded-xl border border-line p-3">
                <p className="ui-label">Periode CUTI</p>
                {selectedLeave ? (
                  <p className="text-xs text-ink-soft">
                    Aktif: {selectedLeave.startDate} → {selectedLeave.endDate}
                  </p>
                ) : null}
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    className="ui-input"
                    type="date"
                    value={leaveStart}
                    onChange={(e) => setLeaveStart(e.target.value)}
                  />
                  <input
                    className="ui-input"
                    type="date"
                    value={leaveEnd}
                    onChange={(e) => setLeaveEnd(e.target.value)}
                  />
                </div>
                <input
                  className="ui-input"
                  placeholder="Alasan cuti / audit"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!leaveStart || !leaveEnd || !reason}
                    onClick={() =>
                      setSenseiLeave(selected.id, { startDate: leaveStart, endDate: leaveEnd }, reason)
                    }
                  >
                    Simpan CUTI
                  </Button>
                  <Button
                    disabled={!reason}
                    onClick={() => {
                      setSenseiLeave(selected.id, null, reason);
                      setLeaveStart('');
                      setLeaveEnd('');
                    }}
                  >
                    Hapus CUTI
                  </Button>
                </div>
              </div>
              <div className="space-y-2 rounded-xl border border-line p-3">
                <p className="ui-label">Override status utama (dengan alasan)</p>
                <input
                  className="ui-input"
                  placeholder="Alasan"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!reason}
                    onClick={() => {
                      overrideSenseiStatus(selected.id, 'ACTIVE', reason);
                      setForm({ ...form, primaryStatus: 'ACTIVE' });
                    }}
                  >
                    Set ACTIVE
                  </Button>
                  <Button
                    tone="danger"
                    disabled={!reason}
                    onClick={() => {
                      overrideSenseiStatus(selected.id, 'INACTIVE', reason);
                      setForm({ ...form, primaryStatus: 'INACTIVE' });
                    }}
                  >
                    Set INACTIVE
                  </Button>
                  <Button
                    disabled={form.timezone === selected.timezone}
                    onClick={() => updateSenseiTimezone(selected.id, form.timezone)}
                  >
                    Sync timezone
                  </Button>
                </div>
              </div>

              {canEditOps ? (
                <div className="flex flex-col items-start gap-3 rounded-xl border border-line p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-ink-soft">
                    Hapus permanen — hanya untuk Sensei yang salah input (belum ada jadwal / sesi / kelas).
                    Kalau sudah punya data, pakai <b>Set INACTIVE</b>.
                  </span>
                  <ConfirmDelete
                    label="Hapus"
                    confirmLabel="Hapus Sensei"
                    message={`Hapus ${selected.name}?`}
                    onConfirm={async () => {
                      const ok = await deleteSensei(selected.id);
                      if (ok) {
                        setSelectedId(null);
                        setCreating(false);
                      }
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
