import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Gauge, Users, Video } from 'lucide-react';
import { buildActionItems, groupActionItems } from '../lib/actionCenter';
import { getClassHealth } from '../lib/classProgress';
import { toDateKey, weekDays } from '../lib/dates';
import { displayName } from '../lib/display';
import { getSessionWorkflow, workflowLabel } from '../lib/session';
import { deriveEnrollmentDisplayStatus, isCurrentEnrollmentStatus } from '../lib/enrollment';
import { getWorkloadMetrics, formatPercent } from '../lib/workload';
import { useDashboardStore, usePermissions, useScopedData } from '../store/useDashboardStore';
import type { ActionItem, TabId } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { PageIntro } from './ui/PageIntro';
import { WeekNav } from './ui/WeekNav';

const PAGE_SIZE = 20;

const KIND_ICON: Record<ActionItem['kind'], typeof Clock> = {
  missing_report: Clock,
  missing_recording: Video,
  late_join: AlertTriangle,
  schedule_conflict: AlertTriangle,
  unassigned_sensei: Users,
  hours_below_target: Gauge,
  low_availability: Clock,
  ending_soon: Clock,
  overdue_class: AlertTriangle
};

const KIND_LABEL: Record<ActionItem['kind'], string> = {
  missing_report: 'Laporan belum masuk',
  missing_recording: 'Rekaman belum ada',
  late_join: 'Clock-in terlambat',
  schedule_conflict: 'Konflik jadwal',
  unassigned_sensei: 'Sensei tanpa kelas',
  hours_below_target: 'Di bawah target jam',
  low_availability: 'Ketersediaan rendah',
  ending_soon: 'Ending soon',
  overdue_class: 'Kelas overdue'
};

const SEV_DOT: Record<ActionItem['severity'], string> = {
  high: 'bg-danger',
  medium: 'bg-warn',
  low: 'bg-line-strong'
};

const KIND_TAB: Record<ActionItem['kind'], TabId> = {
  missing_report: 'teaching',
  late_join: 'teaching',
  missing_recording: 'qa',
  schedule_conflict: 'schedule',
  ending_soon: 'students',
  overdue_class: 'classes',
  unassigned_sensei: 'sensei',
  hours_below_target: 'sensei',
  low_availability: 'availability'
};

function BandHeading({ label, note }: { label: string; note?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-soft">{label}</span>
      {note ? <span className="text-[11px] text-ink-soft">· {note}</span> : null}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function OverviewView() {
  const permissions = usePermissions();
  const leavePeriods = useDashboardStore((state) => state.leavePeriods);
  const enrollments = useDashboardStore((state) => state.enrollments);
  const allStudents = useDashboardStore((state) => state.students);
  const weekAnchor = useDashboardStore((state) => state.weekAnchor);
  const weeklyHourTarget = useDashboardStore((state) => state.settings.weeklyHourTarget);
  const setWeekAnchor = useDashboardStore((state) => state.setWeekAnchor);
  const setTab = useDashboardStore((state) => state.setTab);
  const clockIn = useDashboardStore((state) => state.clockIn);
  const {
    sensei,
    students,
    schedules,
    availability,
    sessionLogs,
    sessionReports,
    classMasters,
    linkedSenseiId
  } = useScopedData();
  const allSensei = useDashboardStore((state) => state.sensei);
  const [selectedKind, setSelectedKind] = useState<ActionItem['kind'] | null>(null);
  const [page, setPage] = useState(0);

  const scopedSensei = permissions.canViewAllSensei ? allSensei : sensei;
  const scopedStudents = permissions.canViewAllSchedules ? allStudents : students;

  const items = buildActionItems({
    sensei: scopedSensei,
    schedules,
    availability,
    logs: sessionLogs,
    reports: sessionReports,
    leavePeriods,
    classMasters,
    enrollments,
    students: allStudents,
    weekAnchor,
    weeklyHourTarget
  });

  const groups = useMemo(() => groupActionItems(items), [items]);
  const selected = selectedKind ? groups.find((group) => group.kind === selectedKind) : undefined;

  useEffect(() => {
    setPage(0);
  }, [selectedKind, weekAnchor, items.length]);

  useEffect(() => {
    if (selectedKind && !groups.some((group) => group.kind === selectedKind)) setSelectedKind(null);
  }, [groups, selectedKind]);

  const detailItems = selected?.items ?? [];
  const pageCount = Math.max(1, Math.ceil(detailItems.length / PAGE_SIZE));
  const pageItems = detailItems.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const today = toDateKey(new Date());
  const weekKeys = useMemo(() => new Set(weekDays(weekAnchor).map((day) => toDateKey(day))), [weekAnchor]);

  const snapshot = useMemo(() => {
    const activeSensei = scopedSensei.filter((item) => item.primaryStatus === 'ACTIVE');
    const activeStudents = scopedStudents.filter((item) => item.isActive).length;
    const schedulesToday = schedules.filter(
      (item) => item.date === today && item.status !== 'cancelled'
    ).length;
    const schedulesWeek = schedules.filter(
      (item) => weekKeys.has(item.date) && item.status !== 'cancelled'
    ).length;
    const activeClasses = classMasters.filter(
      (item) => item.status === 'active' || item.status === 'ready'
    ).length;
    const endingSoon = enrollments.filter((enrollment) => {
      if (!isCurrentEnrollmentStatus(enrollment.status)) return false;
      if (!permissions.canViewAllSchedules) {
        const student = scopedStudents.find((item) => item.id === enrollment.studentId);
        if (!student) return false;
      }
      return (
        deriveEnrollmentDisplayStatus(enrollment, schedules, sessionReports) === 'ending_soon' ||
        enrollment.status === 'ending_soon'
      );
    }).length;
    const endingSoonClasses = classMasters.filter(
      (item) => getClassHealth(item, schedules, sessionReports).status === 'ending_soon'
    ).length;
    const avgUtil =
      activeSensei.reduce((sum, item) => {
        const util = getWorkloadMetrics(item.id, availability, schedules, weekAnchor).utilization;
        return sum + (util ?? 0);
      }, 0) / Math.max(activeSensei.length, 1);

    return {
      activeStudents,
      schedulesToday,
      schedulesWeek,
      activeClasses,
      endingSoon: endingSoon + endingSoonClasses,
      avgUtil
    };
  }, [
    scopedSensei,
    scopedStudents,
    schedules,
    classMasters,
    today,
    weekKeys,
    enrollments,
    permissions.canViewAllSchedules,
    sessionReports,
    availability,
    weekAnchor
  ]);

  const go = (tab: TabId) => setTab(tab);

  const todayBoard = useMemo(
    () =>
      schedules
        .filter((session) => session.date === today && session.status !== 'cancelled')
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map((session) => {
          const log = sessionLogs.find((item) => item.scheduleId === session.id);
          const report = sessionReports.find((item) => item.scheduleId === session.id);
          return { session, log, state: getSessionWorkflow(session, log, report) };
        }),
    [schedules, sessionLogs, sessionReports, today]
  );

  const monitor: Array<{ label: string; value: string | number; note?: string; tab: TabId }> = [
    { label: 'Siswa aktif', value: snapshot.activeStudents, tab: 'students' },
    { label: 'Sesi minggu ini', value: snapshot.schedulesWeek, tab: 'schedule' },
    { label: 'Class Master aktif', value: snapshot.activeClasses, note: 'ready / active', tab: 'classes' },
    { label: 'Ending soon', value: snapshot.endingSoon, note: 'perlu follow-up', tab: 'students' },
    {
      label: 'Utilisasi rata-rata',
      value: formatPercent(snapshot.avgUtil),
      note: snapshot.avgUtil < 0.05 ? 'ketersediaan belum terisi' : undefined,
      tab: 'availability'
    }
  ];

  return (
    <div className="space-y-8">
      <PageIntro
        kicker="Action Center"
        title="Ringkasan operasional"
        actions={<WeekNav weekAnchor={weekAnchor} onChange={setWeekAnchor} />}
      >
        Hari ini di atas, antrian tindakan di tengah, angka pantauan di bawah. Alert sesi memakai lingkup 14
        hari terakhir sampai akhir minggu terpilih.
      </PageIntro>

      {/* ZONE 1 — Hari ini */}
      <section>
        <div className="ui-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-soft">Hari ini</p>
              <p className="text-lg font-semibold tracking-tight text-ink">
                {snapshot.schedulesToday} {snapshot.schedulesToday === 1 ? 'sesi' : 'sesi'}
              </p>
            </div>
            <Button className="h-8" onClick={() => go('teaching')}>
              Buka teaching
            </Button>
          </div>
          {todayBoard.length === 0 ? (
            <p className="px-4 py-8 text-sm text-ink-soft">Tidak ada sesi resmi hari ini.</p>
          ) : (
            <div className="divide-y divide-line">
              {todayBoard.map(({ session, state }) => {
                const own = Boolean(linkedSenseiId && linkedSenseiId === session.senseiId);
                return (
                  <div key={session.id} className="flex items-center gap-3 py-3 pr-4">
                    <span className="h-10 w-0.5 shrink-0 rounded-full bg-line-strong" />
                    <div className="w-16 shrink-0 text-xs tabular-nums text-ink-soft">
                      {session.startTime}
                      <br />
                      {session.endTime}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">{session.level}</div>
                      <div className="truncate text-xs text-ink-soft">
                        {displayName(allSensei, session.senseiId)}
                      </div>
                    </div>
                    <Badge
                      tone={state === 'in_progress' ? 'sky' : state === 'report_pending' ? 'gold' : 'muted'}
                    >
                      {workflowLabel(state)}
                    </Badge>
                    {own && permissions.canClockOwn && state === 'ready' ? (
                      <Button tone="primary" className="h-8" onClick={() => clockIn(session.id)}>
                        Clock in
                      </Button>
                    ) : (
                      <Button className="h-8" onClick={() => go('teaching')}>
                        Buka
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ZONE 2 — Butuh tindakan */}
      <section>
        <BandHeading label="Butuh tindakan" note={items.length ? `${items.length} item` : undefined} />

        {items.length === 0 ? (
          <div className="ui-card flex items-center gap-2 p-6 text-sm text-ok">
            <CheckCircle2 size={18} /> Tidak ada pengecualian pada lingkup ini.
          </div>
        ) : selected ? (
          <div className="ui-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <button
                type="button"
                onClick={() => setSelectedKind(null)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent"
              >
                <ArrowLeft size={14} /> Semua tindakan
              </button>
              <span className="text-sm font-semibold text-ink">
                {KIND_LABEL[selected.kind]} · {selected.count}
              </span>
            </div>
            <div className="divide-y divide-line">
              {pageItems.map((item) => {
                const Icon = KIND_ICON[item.kind];
                return (
                  <div key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`mt-0.5 h-9 w-0.5 shrink-0 rounded-full ${SEV_DOT[item.severity]}`} />
                      <span className="mt-0.5 text-ink-soft">
                        <Icon size={16} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink">{item.title}</div>
                        <p className="text-xs text-ink-soft">{item.detail}</p>
                        {item.senseiId ? (
                          <p className="mt-0.5 text-xs text-ink-soft">
                            Sensei: {displayName(allSensei, item.senseiId)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <button
                      className="shrink-0 text-xs font-semibold text-accent"
                      onClick={() => go(KIND_TAB[item.kind])}
                    >
                      Buka
                    </button>
                  </div>
                );
              })}
            </div>
            {detailItems.length > PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
                <Button
                  className="h-8"
                  disabled={page <= 0}
                  onClick={() => setPage((v) => Math.max(0, v - 1))}
                >
                  Sebelumnya
                </Button>
                <span className="text-xs text-ink-soft">
                  Halaman {page + 1} / {pageCount}
                </span>
                <Button
                  className="h-8"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((v) => Math.min(pageCount - 1, v + 1))}
                >
                  Berikutnya
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => {
              const Icon = KIND_ICON[group.kind];
              return (
                <button
                  key={group.kind}
                  type="button"
                  onClick={() => setSelectedKind(group.kind)}
                  className="ui-card relative flex flex-col gap-1.5 p-4 text-left transition-colors hover:border-line-strong"
                >
                  <span
                    className={`absolute right-4 top-4 h-2 w-2 rounded-full ${SEV_DOT[group.severity]}`}
                  />
                  <span className="flex items-center gap-2 text-ink-soft">
                    <Icon size={15} />
                    <span className="text-2xl font-bold tabular-nums text-ink">{group.count}</span>
                  </span>
                  <span className="text-sm font-semibold text-ink">{KIND_LABEL[group.kind]}</span>
                  <span className="truncate text-xs text-ink-soft">{group.items[0]?.detail}</span>
                  <span className="mt-1 text-xs font-semibold text-accent">Tinjau →</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ZONE 3 — Pantau */}
      <section>
        <BandHeading label="Pantau" note="minggu ini" />
        <div className="ui-card overflow-hidden">
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-5">
            {monitor.map((cell) => (
              <button
                key={cell.label}
                type="button"
                onClick={() => go(cell.tab)}
                className="bg-surface p-4 text-left transition-colors hover:bg-surface-2"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                  {cell.label}
                </p>
                <p className="mt-1.5 text-xl font-bold tabular-nums tracking-tight text-ink">{cell.value}</p>
                {cell.note ? <p className="mt-0.5 text-[11px] text-ink-soft">{cell.note}</p> : null}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
