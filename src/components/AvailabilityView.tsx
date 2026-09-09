import { useState } from 'react';
import { toast } from 'sonner';
import { DAYS_OF_WEEK } from '../constants';
import { displayName } from '../lib/display';
import { isUuid } from '../lib/senseiLink';
import { weekDays } from '../lib/dates';
import { useDashboardStore, usePermissions, useScopedData } from '../store/useDashboardStore';
import type { AvailabilityPattern } from '../types';
import { Button } from './ui/Button';
import { CapacityHeatmap, CapacityLegend } from './ui/CapacityHeatmap';
import { Modal } from './ui/Modal';
import { PageIntro } from './ui/PageIntro';
import { WeekNav } from './ui/WeekNav';

export function AvailabilityView() {
  const permissions = usePermissions();
  const currentUser = useDashboardStore((state) => state.currentUser);
  const allSensei = useDashboardStore((state) => state.sensei);
  const weekAnchor = useDashboardStore((state) => state.weekAnchor);
  const setWeekAnchor = useDashboardStore((state) => state.setWeekAnchor);
  const upsertAvailability = useDashboardStore((state) => state.upsertAvailability);
  const removeAvailability = useDashboardStore((state) => state.removeAvailability);
  const { availability, schedules, sensei, linkedSenseiId } = useScopedData();
  const [open, setOpen] = useState(false);
  const ownSenseiId = linkedSenseiId ?? currentUser?.senseiId ?? '';
  const [form, setForm] = useState({
    senseiId: ownSenseiId,
    pattern: 'weekly' as AvailabilityPattern,
    weekday: 1,
    date: weekAnchor,
    startTime: '09:00',
    endTime: '12:00',
    remarks: ''
  });

  const canEdit = (senseiId: string) =>
    permissions.canOverrideAvailability ||
    (permissions.canMarkOwnAvailability && Boolean(ownSenseiId) && ownSenseiId === senseiId);

  const openModal = () => {
    if (!permissions.canOverrideAvailability && !isUuid(ownSenseiId)) {
      toast.error('Akun Sensei belum tertaut. Di tabel sensei, samakan kolom email dengan email login Auth.');
      return;
    }
    setForm((current) => ({
      ...current,
      senseiId: permissions.canOverrideAvailability
        ? current.senseiId || allSensei.find((item) => item.primaryStatus === 'ACTIVE')?.id || ''
        : ownSenseiId
    }));
    setOpen(true);
  };

  // Ops roster: only ACTIVE Sensei (matches Jadwal Resmi / Class Master / Disiplin).
  // A Sensei viewing their own scope still sees their row even if INACTIVE.
  const visibleSensei = permissions.canViewAllSensei
    ? allSensei.filter((item) => item.primaryStatus === 'ACTIVE')
    : sensei;
  const days = weekDays(weekAnchor);

  const openForDay = (senseiId: string, dateKey: string, weekday: number) => {
    if (!canEdit(senseiId)) return;
    if (!permissions.canOverrideAvailability && !isUuid(ownSenseiId)) {
      toast.error('Akun Sensei belum tertaut. Di tabel sensei, samakan kolom email dengan email login Auth.');
      return;
    }
    setForm({
      senseiId,
      pattern: 'weekly',
      weekday,
      date: dateKey,
      startTime: '09:00',
      endTime: '12:00',
      remarks: ''
    });
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageIntro
        kicker="Ketersediaan"
        title="Ketersediaan Sensei"
        actions={
          <>
            <WeekNav weekAnchor={weekAnchor} onChange={setWeekAnchor} />
            {(permissions.canMarkOwnAvailability || permissions.canOverrideAvailability) && (
              <Button tone="primary" onClick={openModal}>
                Tambah ketersediaan
              </Button>
            )}
          </>
        }
      >
        Ketersediaan adalah slot yang dibuka Sensei, bukan kelas resmi. Admin memakai ini sebagai informasi
        kapasitas sebelum assign.
      </PageIntro>

      <div className="flex flex-col gap-3 rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
        <p>
          Peta minggu ini: latar tipis = jam tersedia, batang biru = sudah terisi jadwal resmi. Ini{' '}
          <b>bukan</b> kalender kelas.
        </p>
        <CapacityLegend />
      </div>

      {!permissions.canViewAllSensei && !isUuid(ownSenseiId) ? (
        <div className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-ink">
          Akun Sensei belum tertaut ke master data. Email login: <b>{currentUser?.email}</b>. Samakan dengan
          kolom <b>email</b> di tabel <b>sensei</b>, atau minta Admin set <b>profiles.sensei_id</b>, lalu
          login ulang.
        </div>
      ) : null}

      <div>
        {visibleSensei.length === 0 ? (
          <div className="ui-card p-4 text-sm text-ink-soft">Tidak ada Sensei pada lingkup akun ini.</div>
        ) : (
          <CapacityHeatmap
            sensei={visibleSensei}
            days={days}
            availability={availability}
            schedules={schedules}
            canEdit={canEdit}
            onAddDay={openForDay}
            onDisableSlot={removeAvailability}
          />
        )}
      </div>

      {open ? (
        <Modal
          title="Buka ketersediaan"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Batal</Button>
              <Button
                tone="primary"
                onClick={() => {
                  const targetId = permissions.canOverrideAvailability ? form.senseiId : ownSenseiId;
                  if (!isUuid(targetId)) {
                    toast.error('Sensei belum tertaut / belum dipilih.');
                    return;
                  }
                  upsertAvailability({
                    senseiId: targetId,
                    pattern: form.pattern,
                    weekday: form.pattern === 'weekly' ? form.weekday : null,
                    date: form.pattern === 'specific_date' ? form.date : null,
                    startTime: form.startTime,
                    endTime: form.endTime,
                    remarks: form.remarks,
                    isActive: true
                  });
                  setOpen(false);
                }}
              >
                Simpan
              </Button>
            </>
          }
        >
          {permissions.canOverrideAvailability ? (
            <label>
              <span className="ui-label">Sensei</span>
              <select
                className="ui-select"
                value={form.senseiId}
                onChange={(event) => setForm({ ...form, senseiId: event.target.value })}
              >
                {allSensei
                  .filter((item) => item.primaryStatus === 'ACTIVE')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <p className="text-sm">Untuk {displayName(allSensei, ownSenseiId)}</p>
          )}
          <label>
            <span className="ui-label">Pola</span>
            <select
              className="ui-select"
              value={form.pattern}
              onChange={(event) => setForm({ ...form, pattern: event.target.value as AvailabilityPattern })}
            >
              <option value="weekly">Mingguan berulang</option>
              <option value="specific_date">Tanggal spesifik</option>
            </select>
          </label>
          {form.pattern === 'weekly' ? (
            <label>
              <span className="ui-label">Hari</span>
              <select
                className="ui-select"
                value={form.weekday}
                onChange={(event) => setForm({ ...form, weekday: Number(event.target.value) })}
              >
                {DAYS_OF_WEEK.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              <span className="ui-label">Tanggal</span>
              <input
                className="ui-input"
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="ui-label">Mulai</span>
              <input
                className="ui-input"
                type="time"
                value={form.startTime}
                onChange={(event) => setForm({ ...form, startTime: event.target.value })}
              />
            </label>
            <label>
              <span className="ui-label">Selesai</span>
              <input
                className="ui-input"
                type="time"
                value={form.endTime}
                onChange={(event) => setForm({ ...form, endTime: event.target.value })}
              />
            </label>
          </div>
          <label>
            <span className="ui-label">Catatan (opsional)</span>
            <input
              className="ui-input"
              value={form.remarks}
              onChange={(event) => setForm({ ...form, remarks: event.target.value })}
            />
          </label>
        </Modal>
      ) : null}
    </div>
  );
}
