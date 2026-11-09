import { useMemo, useState } from 'react';
import { buildEomSessionRows, downloadEomExcel, eomRowsToCsv, summarizeEomBySensei } from '../lib/eomReport';
import { sortSenseiActiveFirst } from '../lib/senseiOrder';
import { useDashboardStore, usePermissions, useScopedData } from '../store/useDashboardStore';
import type { ClassStatus } from '../types';
import { Button } from './ui/Button';
import { PageIntro } from './ui/PageIntro';

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/** clockIn/clockOut are "yyyy-MM-dd HH:mm"; drop the date when it matches the session date. */
function clockTime(value: string, sessionDate: string) {
  if (!value) return '—';
  const [day, time] = value.split(' ');
  return day === sessionDate ? time : `${time} ${day.slice(5)}`;
}

export function ReportsView() {
  const permissions = usePermissions();
  const currentUser = useDashboardStore((state) => state.currentUser);
  const allSensei = useDashboardStore((state) => state.sensei);
  const allStudents = useDashboardStore((state) => state.students);
  const allClassMasters = useDashboardStore((state) => state.classMasters);
  const allSchedules = useDashboardStore((state) => state.schedules);
  const allLogs = useDashboardStore((state) => state.sessionLogs);
  const allReports = useDashboardStore((state) => state.sessionReports);
  const { sensei, schedules, sessionLogs, sessionReports, classMasters, linkedSenseiId } = useScopedData();

  const [month, setMonth] = useState(currentMonth());
  const [senseiFilter, setSenseiFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<ClassStatus | 'all'>('all');
  const [showRecap, setShowRecap] = useState(true);

  const effectiveSenseiId = permissions.canViewAllSchedules
    ? senseiFilter
    : linkedSenseiId || currentUser?.senseiId || 'none';

  const rows = useMemo(
    () =>
      buildEomSessionRows({
        month,
        senseiId: effectiveSenseiId === 'none' ? 'none' : effectiveSenseiId,
        status: statusFilter,
        schedules: permissions.canViewAllSchedules ? allSchedules : schedules,
        sessionLogs: permissions.canViewAllSchedules ? allLogs : sessionLogs,
        sessionReports: permissions.canViewAllSchedules ? allReports : sessionReports,
        classMasters: permissions.canViewAllSchedules ? allClassMasters : classMasters,
        sensei: permissions.canViewAllSchedules ? allSensei : sensei,
        students: allStudents
      }),
    [
      month,
      effectiveSenseiId,
      statusFilter,
      permissions.canViewAllSchedules,
      allSchedules,
      schedules,
      allLogs,
      sessionLogs,
      allReports,
      sessionReports,
      allClassMasters,
      classMasters,
      allSensei,
      sensei,
      allStudents
    ]
  );

  const summaries = useMemo(() => summarizeEomBySensei(rows), [rows]);

  const onDownload = () => {
    if (!permissions.canExportEomReport) return;
    const csv = eomRowsToCsv(rows, summaries);
    downloadEomExcel(`eom-sensei-${month}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      <PageIntro
        kicker="Laporan EOM"
        title="Laporan EOM"
        actions={
          <>
            <Button tone={showRecap ? 'primary' : undefined} onClick={() => setShowRecap(true)}>
              View Recap
            </Button>
            {permissions.canExportEomReport ? (
              <Button tone="primary" onClick={onDownload} disabled={rows.length === 0}>
                Download Excel
              </Button>
            ) : (
              <p className="self-center text-xs text-ink-soft">Export Excel hanya untuk Super Admin / Ops.</p>
            )}
          </>
        }
      >
        Rekap mengajar bulanan untuk verifikasi EOM. Tanpa perhitungan gaji/honor.
      </PageIntro>

      <div className="ui-card grid gap-3 p-4 md:grid-cols-3">
        <label>
          <span className="ui-label">Bulan</span>
          <input
            className="ui-input"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        {permissions.canViewAllSchedules ? (
          <label>
            <span className="ui-label">Sensei</span>
            <select
              className="ui-select"
              value={senseiFilter}
              onChange={(event) => setSenseiFilter(event.target.value)}
            >
              <option value="all">Semua Sensei</option>
              {sortSenseiActiveFirst(allSensei).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.primaryStatus === 'ACTIVE' ? '' : ' (nonaktif)'}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div>
            <span className="ui-label">Sensei</span>
            <p className="mt-2 text-sm font-semibold">{sensei[0]?.name || 'Rekap sendiri'}</p>
          </div>
        )}
        <label>
          <span className="ui-label">Status sesi</span>
          <select
            className="ui-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ClassStatus | 'all')}
          >
            <option value="all">Semua</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>

      {showRecap ? (
        <>
          <div className="ui-card overflow-auto">
            <table className="ui-table min-w-[1100px]">
              <thead>
                <tr>
                  <th>Sensei</th>
                  <th>Class</th>
                  <th>Level / Type</th>
                  <th>Students</th>
                  <th>Date</th>
                  <th>Schedule</th>
                  <th>Clock</th>
                  <th>Durasi</th>
                  <th>X/X</th>
                  <th>Status</th>
                  <th>Late / Swap / Cancel</th>
                  <th>Kind</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-center text-ink-soft">
                      Tidak ada sesi di filter ini.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={`${row.senseiId}-${row.date}-${row.startTime}-${index}`}>
                      <td className="font-medium text-ink">{row.senseiName}</td>
                      <td className="text-ink-soft">{row.className}</td>
                      <td>
                        {row.level}
                        <div className="text-xs text-ink-soft">{row.classType}</div>
                      </td>
                      <td className="text-ink-soft">{row.students || '—'}</td>
                      <td className="whitespace-nowrap tabular-nums text-ink-soft">{row.date}</td>
                      <td className="whitespace-nowrap tabular-nums text-ink-soft">
                        {row.startTime}–{row.endTime}
                      </td>
                      <td className="whitespace-nowrap text-xs tabular-nums text-ink-soft">
                        {row.clockIn || row.clockOut ? (
                          <>
                            {clockTime(row.clockIn, row.date)}
                            <span className="px-1 text-ink-soft/60">→</span>
                            {clockTime(row.clockOut, row.date)}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs tabular-nums text-ink-soft">
                        {row.scheduledMinutes}m<span className="px-1 text-ink-soft/60">→</span>
                        {row.actualMinutes == null ? '—' : `${row.actualMinutes}m`}
                      </td>
                      <td className="text-ink-soft">{row.sessionLabel}</td>
                      <td className="text-ink-soft">{row.status}</td>
                      <td className="text-xs text-ink-soft">
                        {row.lateJoin === 'Yes' ? `Late ${row.lateMinutes || '?'}m` : 'On time'}
                        {row.swap ? <div>{row.swap}</div> : null}
                        {row.cancellation ? <div>{row.cancellation}</div> : null}
                      </td>
                      <td className="text-ink-soft">{row.sessionKind}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="ui-card overflow-hidden">
            <p className="border-b border-line px-4 py-3 text-sm font-semibold">Summary per Sensei</p>
            <div className="overflow-auto">
              <table className="ui-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Sensei</th>
                    <th className="num">Completed</th>
                    <th className="num">Scheduled hours</th>
                    <th className="num">Actual hours</th>
                    <th className="num">Late joins</th>
                    <th className="num">Sensei swaps</th>
                    <th className="num">Sensei cancels</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((item) => (
                    <tr key={item.senseiId}>
                      <td className="font-medium text-ink">{item.senseiName}</td>
                      <td className="num text-ink">{item.completedSessions}</td>
                      <td className="num text-ink-soft">{item.scheduledHours.toFixed(2)}</td>
                      <td className="num text-ink-soft">{item.actualHours.toFixed(2)}</td>
                      <td className="num text-ink-soft">{item.lateJoins}</td>
                      <td className="num text-ink-soft">{item.senseiInitiatedSwaps}</td>
                      <td className="num text-ink-soft">{item.senseiRelatedCancellations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
