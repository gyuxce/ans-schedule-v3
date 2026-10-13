import { useMemo, useState } from 'react';
import { planClassTakeOver } from '../../lib/classSync';
import { toDateKey } from '../../lib/dates';
import { useDashboardStore, usePermissions } from '../../store/useDashboardStore';
import { Button } from './Button';

export function TakeOverPanel({
  classIds,
  fromSenseiId,
  onDone
}: {
  classIds: string[];
  fromSenseiId: string;
  onDone?: () => void;
}) {
  const permissions = usePermissions();
  const allSensei = useDashboardStore((state) => state.sensei);
  const classMasters = useDashboardStore((state) => state.classMasters);
  const schedules = useDashboardStore((state) => state.schedules);
  const sessionReports = useDashboardStore((state) => state.sessionReports);
  const takeOverClasses = useDashboardStore((state) => state.takeOverClasses);
  const [newSenseiId, setNewSenseiId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(toDateKey(new Date()));
  const [reason, setReason] = useState('');

  const classes = useMemo(
    () => classMasters.filter((item) => classIds.includes(item.id) && item.senseiId === fromSenseiId),
    [classMasters, classIds, fromSenseiId]
  );

  const preview = useMemo(() => {
    if (!newSenseiId || !effectiveDate) return null;
    let moved = 0;
    let conflicts = 0;
    for (const teachingClass of classes) {
      const plan = planClassTakeOver({
        schedules,
        reports: sessionReports,
        classId: teachingClass.id,
        newSenseiId,
        effectiveDate,
        reason: 'preview'
      });
      moved += plan.moved.length;
      conflicts += plan.conflicts.length;
    }
    return { moved, conflicts };
  }, [classes, schedules, sessionReports, newSenseiId, effectiveDate]);

  if (!permissions.canAssignSensei || classes.length === 0) return null;

  const canSubmit = Boolean(newSenseiId && effectiveDate && reason.trim() && preview?.conflicts === 0);

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <div>
        <p className="ui-label">Take Over kelas ({classes.length})</p>
        <p className="text-xs text-ink-soft">
          Pindahkan kelas ke Sensei lain secara permanen: Class Master, enrollment, dan semua sesi mulai
          tanggal berlaku yang belum ada laporannya. Sesi yang sudah lewat tetap atas nama Sensei lama. Sensei
          pengganti otomatis bisa melihat riwayat dan materi kelas.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <span className="ui-label">
            Sensei pengganti <span className="text-danger">*</span>
          </span>
          <select
            className="ui-select"
            value={newSenseiId}
            onChange={(event) => setNewSenseiId(event.target.value)}
          >
            <option value="">Pilih Sensei</option>
            {allSensei
              .filter((item) => item.id !== fromSenseiId && item.primaryStatus === 'ACTIVE')
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span className="ui-label">
            Berlaku mulai <span className="text-danger">*</span>
          </span>
          <input
            className="ui-input"
            type="date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </label>
      </div>
      <label className="block">
        <span className="ui-label">
          Alasan Take Over (audit) <span className="text-danger">*</span>
        </span>
        <input
          className="ui-input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Contoh: Sensei resign"
        />
      </label>
      {preview ? (
        preview.conflicts > 0 ? (
          <p className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-xs text-ink">
            Sensei ini bentrok di {preview.conflicts} sesi. Pilih Sensei lain atau ubah tanggal berlaku.
          </p>
        ) : (
          <p className="text-xs text-ink-soft">
            {preview.moved} sesi mendatang akan dipindahkan ke Sensei pengganti.
          </p>
        )
      ) : null}
      <Button
        tone="primary"
        disabled={!canSubmit}
        onClick={() => {
          const ok = takeOverClasses({
            classIds: classes.map((item) => item.id),
            newSenseiId,
            effectiveDate,
            reason
          });
          if (ok) {
            setNewSenseiId('');
            setReason('');
            onDone?.();
          }
        }}
      >
        Take Over
      </Button>
    </div>
  );
}
