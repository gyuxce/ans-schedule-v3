import { useEffect, useMemo, useState } from 'react';
import { ATTENDANCE_OPTIONS } from '../constants';
import { getSessionOrdinal } from '../lib/classProgress';
import { combineDateTime, formatDateTime, toDateKey, weekDays } from '../lib/dates';
import { ATTENDANCE_TONE, displayName, TYPE_RAIL, TYPE_TONE, WORKFLOW_TONE } from '../lib/display';
import {
  actualDurationMinutes,
  durationVarianceMinutes,
  formatDurationMinutes,
  scheduledDurationMinutes
} from '../lib/duration';
import { getSessionWorkflow, workflowLabel } from '../lib/session';
import { formatCountdown, useNow } from '../lib/useNow';
import { useDashboardStore, usePermissions, useScopedData } from '../store/useDashboardStore';
import type {
  AttendanceStatus,
  ClassSession,
  RecordingStatus,
  SessionLog,
  SessionReport,
  SessionWorkflowState,
  Student,
  StudentSessionRecord
} from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { FilterChips } from './ui/FilterChips';
import { Meter } from './ui/Meter';
import { Modal } from './ui/Modal';
import { PageIntro } from './ui/PageIntro';
import { WeekNav } from './ui/WeekNav';

const PAGE_SIZE = 25;

function studentSummary(studentIds: string[], students: Student[]) {
  if (!studentIds.length) return 'Tanpa siswa';
  const names = studentIds.map((id) => displayName(students, id));
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

export function TeachingView() {
  const permissions = usePermissions();
  const allStudents = useDashboardStore((state) => state.students);
  const allSensei = useDashboardStore((state) => state.sensei);
  const classMasters = useDashboardStore((state) => state.classMasters);
  const weekAnchor = useDashboardStore((state) => state.weekAnchor);
  const setWeekAnchor = useDashboardStore((state) => state.setWeekAnchor);
  const clockIn = useDashboardStore((state) => state.clockIn);
  const clockOut = useDashboardStore((state) => state.clockOut);
  const overrideClock = useDashboardStore((state) => state.overrideClock);
  const submitSessionReport = useDashboardStore((state) => state.submitSessionReport);
  const overrideAttendance = useDashboardStore((state) => state.overrideAttendance);
  const overridePerformance = useDashboardStore((state) => state.overridePerformance);
  const { schedules, sessionLogs, sessionReports, linkedSenseiId } = useScopedData();
  const [selected, setSelected] = useState<ClassSession | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [clockInAt, setClockInAt] = useState('');
  const [clockOutAt, setClockOutAt] = useState('');
  const [rangeMode, setRangeMode] = useState<'week' | 'upcoming' | 'all'>('week');
  const [statusFilter, setStatusFilter] = useState<'all' | SessionWorkflowState>('all');
  const [senseiFilter, setSenseiFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const weekKeys = useMemo(() => new Set(weekDays(weekAnchor).map((day) => toDateKey(day))), [weekAnchor]);
  const today = toDateKey(new Date());

  const rows = useMemo(
    () =>
      [...schedules]
        .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
        .map((session) => {
          const log = sessionLogs.find((item) => item.scheduleId === session.id);
          const report = sessionReports.find((item) => item.scheduleId === session.id);
          const teachingClass = classMasters.find((item) => item.id === session.classId);
          const ordinal = getSessionOrdinal(session, schedules, teachingClass);
          const scheduled = scheduledDurationMinutes(session);
          const actual = actualDurationMinutes(log);
          const variance = durationVarianceMinutes(session, log);
          return {
            session,
            log,
            report,
            state: getSessionWorkflow(session, log, report),
            ordinal,
            scheduled,
            actual,
            variance
          };
        }),
    [schedules, sessionLogs, sessionReports, classMasters]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(({ session, state }) => {
      if (rangeMode === 'week' && !weekKeys.has(session.date)) return false;
      if (rangeMode === 'upcoming' && session.date < today) return false;
      if (statusFilter !== 'all' && state !== statusFilter) return false;
      if (senseiFilter !== 'all' && session.senseiId !== senseiFilter) return false;
      if (!q) return true;
      const hay = [
        session.level,
        session.type,
        displayName(allSensei, session.senseiId),
        ...session.studentIds.map((id) => displayName(allStudents, id))
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, rangeMode, weekKeys, today, statusFilter, senseiFilter, query, allSensei, allStudents]);

  useEffect(() => {
    setPage(0);
  }, [rangeMode, statusFilter, senseiFilter, query, weekAnchor]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const selectedLog = selected ? sessionLogs.find((item) => item.scheduleId === selected.id) : undefined;
  const selectedReport = selected
    ? sessionReports.find((item) => item.scheduleId === selected.id)
    : undefined;
  const selectedState = selected ? getSessionWorkflow(selected, selectedLog, selectedReport) : 'ready';
  const canClock = Boolean(
    selected && permissions.canClockOwn && linkedSenseiId && linkedSenseiId === selected.senseiId
  );

  const nowRows = useMemo(
    () =>
      rows.filter(
        ({ session, state }) =>
          session.date === today &&
          (state === 'ready' || state === 'in_progress' || state === 'report_pending')
      ),
    [rows, today]
  );

  const openSession = (session: ClassSession) => {
    const log = sessionLogs.find((item) => item.scheduleId === session.id);
    setSelected(session);
    setClockInAt(log?.clockInAt?.slice(0, 16) ?? '');
    setClockOutAt(log?.clockOutAt?.slice(0, 16) ?? '');
    setOverrideReason('');
  };

  const now = useNow(30_000);
  const featured =
    nowRows.find((row) => row.state === 'in_progress') ||
    nowRows.find((row) => row.state === 'ready') ||
    nowRows[0];
  const todayTimeline = rows.filter(({ session }) => session.date === today);

  return (
    <div className="space-y-6">
      <PageIntro
        kicker="Sesi Mengajar"
        title="Sesi hari ini"
        actions={<WeekNav weekAnchor={weekAnchor} onChange={setWeekAnchor} />}
      >
        Alur Sensei: Jadwal → Clock In → Mengajar → Clock Out → Laporan Sesi. Default menampilkan minggu yang
        dipilih.
      </PageIntro>

      {featured ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(220px,0.7fr)]">
          <div className="ui-card relative overflow-hidden p-5">
            <span className={`absolute inset-y-0 left-0 w-1.5 ${TYPE_RAIL[featured.session.type]}`} />
            <div className="flex flex-wrap items-start justify-between gap-3 pl-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  Hari ini · {featured.session.startTime}–{featured.session.endTime}
                </p>
                <h3 className="mt-1 text-2xl font-bold tracking-tight text-ink">{featured.session.level}</h3>
                <p className="text-sm text-ink-soft">
                  {studentSummary(featured.session.studentIds, allStudents)}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  {displayName(allSensei, featured.session.senseiId)}
                </p>
                {featured.state === 'ready' ? (
                  <p className="mt-2 text-sm font-semibold text-accent">
                    {formatCountdown(
                      combineDateTime(featured.session.date, featured.session.startTime),
                      now
                    ) || 'Waktunya mulai'}
                  </p>
                ) : null}
              </div>
              <Badge tone={WORKFLOW_TONE[featured.state]}>{workflowLabel(featured.state)}</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 pl-2">
              {permissions.canClockOwn &&
              linkedSenseiId === featured.session.senseiId &&
              featured.state === 'ready' ? (
                <Button tone="primary" onClick={() => clockIn(featured.session.id)}>
                  Clock in
                </Button>
              ) : null}
              {permissions.canClockOwn &&
              linkedSenseiId === featured.session.senseiId &&
              featured.state === 'in_progress' ? (
                <Button tone="primary" onClick={() => clockOut(featured.session.id)}>
                  Clock out
                </Button>
              ) : null}
              <Button onClick={() => openSession(featured.session)}>Detail</Button>
            </div>
            {featured.log?.clockInAt ? (
              <p className="mt-3 pl-2 text-[11px] text-ink-soft">
                Clock in {formatDateTime(featured.log.clockInAt)}
              </p>
            ) : null}
          </div>
          <div className="ui-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Timeline hari ini
            </p>
            <div className="mt-3 space-y-3">
              {todayTimeline.length === 0 ? (
                <p className="text-sm text-ink-soft">Tidak ada sesi hari ini.</p>
              ) : (
                todayTimeline.slice(0, 8).map(({ session, state }) => (
                  <button
                    key={session.id}
                    type="button"
                    className="flex w-full items-start gap-3 text-left"
                    onClick={() => openSession(session)}
                  >
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${TYPE_RAIL[session.type]}`} />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-ink">
                        {session.startTime} · {session.level}
                      </span>
                      <span className="block text-[11px] text-ink-soft">{workflowLabel(state)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="ui-card px-5 py-4 text-sm text-ink-soft">Tidak ada sesi aktif untuk hari ini.</div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterChips
          value={rangeMode}
          onChange={(mode) => {
            setRangeMode(mode);
            // "Minggu ini" here must mean the current week, not whatever week
            // weekAnchor happens to hold — weekAnchor is shared across pages,
            // so it can still be pointed at a week the user navigated to
            // earlier via WeekNav on this or another page.
            if (mode === 'week') setWeekAnchor(toDateKey(new Date()));
          }}
          options={[
            { id: 'week', label: 'Minggu ini' },
            { id: 'upcoming', label: 'Hari ini & ke depan' },
            { id: 'all', label: 'Semua' }
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <select
            className="ui-select h-9 w-auto min-w-[160px]"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | SessionWorkflowState)}
          >
            <option value="all">Semua status</option>
            <option value="ready">Belum mulai</option>
            <option value="in_progress">Berlangsung</option>
            <option value="report_pending">Menunggu laporan</option>
            <option value="completed">Selesai</option>
            <option value="cancelled">Dibatalkan</option>
          </select>
          <select
            className="ui-select h-9 w-auto min-w-[160px]"
            value={senseiFilter}
            onChange={(event) => setSenseiFilter(event.target.value)}
          >
            <option value="all">Semua Sensei</option>
            {(permissions.canViewAllSchedules
              ? allSensei.filter((item) => item.primaryStatus === 'ACTIVE')
              : allSensei.filter((item) => item.id === linkedSenseiId)
            ).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <input
            className="ui-input h-9 w-44"
            placeholder="Cari"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="ui-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-ink-soft">
          <span>
            {filtered.length === 0
              ? '0 sesi'
              : `Menampilkan ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)} dari ${filtered.length} sesi`}
          </span>
          {rangeMode === 'all' ? <span>Tip: pakai filter minggu agar lebih ringan.</span> : null}
        </div>
        <div className="divide-y divide-line">
          {pageRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-soft">Tidak ada sesi pada filter ini.</div>
          ) : (
            pageRows.map(({ session, log, state, ordinal }) => (
              <button
                key={session.id}
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
                onClick={() => openSession(session)}
              >
                <span className={`h-8 w-1.5 shrink-0 rounded-full ${TYPE_RAIL[session.type]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{session.level}</span>
                    <Badge tone={TYPE_TONE[session.type]}>{session.type}</Badge>
                    <Badge tone={WORKFLOW_TONE[state]}>{workflowLabel(state)}</Badge>
                  </div>
                  <p className="truncate text-xs text-ink-soft">
                    {session.date} · {session.startTime}–{session.endTime} ·{' '}
                    {displayName(allSensei, session.senseiId)} ·{' '}
                    {studentSummary(session.studentIds, allStudents)}
                  </p>
                  {ordinal && ordinal.required > 0 ? (
                    <Meter className="mt-1.5 max-w-[180px]" value={ordinal.index} max={ordinal.required} />
                  ) : null}
                </div>
                <div className="hidden shrink-0 text-right text-[11px] text-ink-soft sm:block">
                  <div>
                    {log?.clockInAt ? 'In ·' : 'In ○'} {log?.clockOutAt ? 'Out ·' : 'Out ○'}
                  </div>
                  {log?.lateJoin ? <div className="font-bold text-danger">Terlambat</div> : null}
                </div>
              </button>
            ))
          )}
        </div>
        {filtered.length > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
            <Button disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
              Sebelumnya
            </Button>
            <span className="text-xs text-ink-soft">
              Halaman {page + 1} / {pageCount}
            </span>
            <Button
              disabled={page >= pageCount - 1}
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            >
              Berikutnya
            </Button>
          </div>
        ) : null}
      </div>
      {selected ? (
        <SessionDrawer
          session={selected}
          state={selectedState}
          canOperate={canClock}
          canOverride={permissions.canOverrideClock || permissions.canOverrideAcademic}
          onClose={() => setSelected(null)}
          onClockIn={() => clockIn(selected.id)}
          onClockOut={() => clockOut(selected.id)}
          clockInAt={clockInAt}
          clockOutAt={clockOutAt}
          setClockInAt={setClockInAt}
          setClockOutAt={setClockOutAt}
          overrideReason={overrideReason}
          setOverrideReason={setOverrideReason}
          onOverrideClock={() => {
            if (!clockInAt || !overrideReason) return;
            overrideClock(
              selected.id,
              new Date(clockInAt).toISOString(),
              clockOutAt ? new Date(clockOutAt).toISOString() : null,
              overrideReason
            );
          }}
          report={selectedReport}
          log={selectedLog}
          students={allStudents}
          onSubmit={submitSessionReport}
          onOverrideAttendance={overrideAttendance}
          onOverridePerformance={overridePerformance}
          canInput={
            Boolean(
              permissions.canInputAttendance && linkedSenseiId && linkedSenseiId === selected.senseiId
            ) || permissions.canOverrideAcademic
          }
        />
      ) : null}
    </div>
  );
}

function SessionDrawer(props: {
  session: ClassSession;
  state: SessionWorkflowState;
  canOperate: boolean;
  canOverride: boolean;
  onClose: () => void;
  onClockIn: () => void;
  onClockOut: () => void;
  clockInAt: string;
  clockOutAt: string;
  setClockInAt: (value: string) => void;
  setClockOutAt: (value: string) => void;
  overrideReason: string;
  setOverrideReason: (value: string) => void;
  onOverrideClock: () => void;
  report?: SessionReport;
  log?: SessionLog;
  students: Student[];
  onSubmit: (
    scheduleId: string,
    payload: {
      students: StudentSessionRecord[];
      materialCovered: string;
      materialUrl?: string;
      levelProgress: string;
      sessionNotes?: string;
      recordingUrl?: string;
      recordingStatus: RecordingStatus;
    }
  ) => void;
  onOverrideAttendance: (
    reportId: string,
    studentId: string,
    attendance: AttendanceStatus,
    reason: string
  ) => void;
  onOverridePerformance: (reportId: string, studentId: string, score: number, reason: string) => void;
  canInput: boolean;
}) {
  const classMasters = useDashboardStore((state) => state.classMasters);
  const schedules = useDashboardStore((state) => state.schedules);
  const teachingClass = classMasters.find((item) => item.id === props.session.classId);
  const ordinal = getSessionOrdinal(props.session, schedules, teachingClass);
  const scheduled = scheduledDurationMinutes(props.session);
  const actual = actualDurationMinutes(props.log);
  const variance = durationVarianceMinutes(props.session, props.log);
  const [records, setRecords] = useState<StudentSessionRecord[]>(
    props.report?.students ??
      props.session.studentIds.map((studentId) => ({
        studentId,
        attendance: 'Present' as AttendanceStatus,
        performanceScore: 80,
        performanceNote: ''
      }))
  );
  const [materialCovered, setMaterialCovered] = useState(props.report?.materialCovered ?? '');
  const [materialUrl, setMaterialUrl] = useState(
    props.report?.materialUrl ?? teachingClass?.materialLink ?? ''
  );
  const [levelProgress, setLevelProgress] = useState(props.report?.levelProgress ?? '');
  const [sessionNotes, setSessionNotes] = useState(props.report?.sessionNotes ?? '');
  const [recordingUrl, setRecordingUrl] = useState(props.report?.recordingUrl ?? '');
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>(
    props.report?.recordingStatus ?? 'Missing'
  );
  const [academicReason, setAcademicReason] = useState('');

  return (
    <Modal
      wide
      title={`${props.session.level} · ${props.session.date} ${props.session.startTime}`}
      onClose={props.onClose}
      footer={<Button onClick={props.onClose}>Tutup</Button>}
    >
      <div className="flex flex-wrap gap-2">
        <Badge tone={WORKFLOW_TONE[props.state]}>{workflowLabel(props.state)}</Badge>
        {ordinal ? <Badge tone="maple">{ordinal.label}</Badge> : null}
        {teachingClass ? <Badge>{teachingClass.displayName}</Badge> : null}
        {props.log?.lateJoin ? <Badge tone="danger">Late join</Badge> : null}
        {props.log?.overridden ? <Badge tone="gold">Clock override</Badge> : null}
      </div>
      <div className="grid gap-2 rounded-xl border border-line p-3 text-sm md:grid-cols-3">
        <div>
          <p className="ui-label">Durasi jadwal</p>
          <p className="font-semibold">{formatDurationMinutes(scheduled)}</p>
        </div>
        <div>
          <p className="ui-label">Durasi aktual</p>
          <p className="font-semibold">{formatDurationMinutes(actual)}</p>
          <p className="text-xs text-ink-soft">Clock Out − Clock In</p>
        </div>
        <div>
          <p className="ui-label">Selisih</p>
          <p className={`font-semibold ${variance != null && variance < 0 ? 'text-danger' : ''}`}>
            {formatDurationMinutes(variance)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {props.canOperate && props.state === 'ready' ? (
          <Button tone="primary" onClick={props.onClockIn}>
            Clock in
          </Button>
        ) : null}
        {props.canOperate && props.state === 'in_progress' ? (
          <Button tone="primary" onClick={props.onClockOut}>
            Clock out
          </Button>
        ) : null}
      </div>
      {props.canOverride ? (
        <div className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-3">
          <input
            className="ui-input"
            type="datetime-local"
            value={props.clockInAt}
            onChange={(event) => props.setClockInAt(event.target.value)}
          />
          <input
            className="ui-input"
            type="datetime-local"
            value={props.clockOutAt}
            onChange={(event) => props.setClockOutAt(event.target.value)}
          />
          <input
            className="ui-input"
            placeholder="Alasan override"
            value={props.overrideReason}
            onChange={(event) => props.setOverrideReason(event.target.value)}
          />
          <Button className="md:col-span-3" onClick={props.onOverrideClock} disabled={!props.overrideReason}>
            Override clock-in/out
          </Button>
        </div>
      ) : null}

      <h4 className="font-semibold">Laporan sesi</h4>
      {records.map((record, index) => (
        <div key={record.studentId} className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-4">
          <div className="font-semibold">{displayName(props.students, record.studentId)}</div>
          <select
            className="ui-select"
            value={record.attendance}
            disabled={!props.canInput}
            onChange={(event) => {
              const attendance = event.target.value as AttendanceStatus;
              const next = records.map((item, itemIndex) =>
                itemIndex === index ? { ...item, attendance } : item
              );
              setRecords(next);
            }}
          >
            {ATTENDANCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            className="ui-input"
            type="number"
            min={0}
            max={100}
            value={record.performanceScore ?? ''}
            disabled={!props.canInput}
            onChange={(event) => {
              const performanceScore = Number(event.target.value);
              setRecords(
                records.map((item, itemIndex) => (itemIndex === index ? { ...item, performanceScore } : item))
              );
            }}
          />
          <input
            className="ui-input"
            placeholder="Catatan performa"
            value={record.performanceNote ?? ''}
            disabled={!props.canInput}
            onChange={(event) => {
              const performanceNote = event.target.value;
              setRecords(
                records.map((item, itemIndex) => (itemIndex === index ? { ...item, performanceNote } : item))
              );
            }}
          />
          {record.attendance ? (
            <Badge tone={ATTENDANCE_TONE[record.attendance]}>{record.attendance}</Badge>
          ) : null}
        </div>
      ))}
      <label>
        <span className="ui-label">Materi / topik</span>
        <input
          className="ui-input"
          value={materialCovered}
          disabled={!props.canInput}
          onChange={(event) => setMaterialCovered(event.target.value)}
        />
      </label>
      <label>
        <span className="ui-label">Link materi (opsional)</span>
        <input
          className="ui-input"
          value={materialUrl}
          disabled={!props.canInput}
          onChange={(event) => setMaterialUrl(event.target.value)}
        />
      </label>
      <label>
        <span className="ui-label">Progres level</span>
        <input
          className="ui-input"
          value={levelProgress}
          disabled={!props.canInput}
          onChange={(event) => setLevelProgress(event.target.value)}
        />
      </label>
      <label>
        <span className="ui-label">Catatan sesi</span>
        <textarea
          className="ui-textarea"
          value={sessionNotes}
          disabled={!props.canInput}
          onChange={(event) => setSessionNotes(event.target.value)}
        />
      </label>
      <div className="grid gap-2 md:grid-cols-2">
        <label>
          <span className="ui-label">Link rekaman</span>
          <input
            className="ui-input"
            value={recordingUrl}
            disabled={!props.canInput}
            onChange={(event) => setRecordingUrl(event.target.value)}
          />
        </label>
        <label>
          <span className="ui-label">Status rekaman</span>
          <select
            className="ui-select"
            value={recordingStatus}
            disabled={!props.canInput}
            onChange={(event) => setRecordingStatus(event.target.value as RecordingStatus)}
          >
            <option>Available</option>
            <option>Missing</option>
            <option>Not Required</option>
          </select>
        </label>
      </div>
      {props.canInput ? (
        <Button
          tone="primary"
          disabled={
            !materialCovered ||
            props.state === 'ready' ||
            props.state === 'in_progress' ||
            props.state === 'cancelled'
          }
          onClick={() =>
            props.onSubmit(props.session.id, {
              students: records,
              materialCovered,
              materialUrl: materialUrl || undefined,
              levelProgress,
              sessionNotes,
              recordingUrl,
              recordingStatus
            })
          }
        >
          Simpan laporan sesi
        </Button>
      ) : null}
      {props.canOverride && props.report ? (
        <div className="rounded-xl border border-line p-3">
          <p className="ui-label">Koreksi akademik (audit)</p>
          <input
            className="ui-input"
            placeholder="Alasan koreksi"
            value={academicReason}
            onChange={(event) => setAcademicReason(event.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {records.map((record) => (
              <Button
                key={`att-${record.studentId}`}
                disabled={!academicReason}
                onClick={() =>
                  props.onOverrideAttendance(
                    props.report!.id,
                    record.studentId,
                    record.attendance,
                    academicReason
                  )
                }
              >
                Koreksi absensi {displayName(props.students, record.studentId)}
              </Button>
            ))}
            {records.map((record) => (
              <Button
                key={`score-${record.studentId}`}
                disabled={!academicReason || record.performanceScore == null}
                onClick={() =>
                  props.onOverridePerformance(
                    props.report!.id,
                    record.studentId,
                    record.performanceScore ?? 0,
                    academicReason
                  )
                }
              >
                Koreksi nilai {displayName(props.students, record.studentId)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {props.state === 'ready' || props.state === 'in_progress' ? (
        <p className="text-xs text-ink-soft">Laporan hanya bisa dikirim setelah clock-out.</p>
      ) : null}
    </Modal>
  );
}
