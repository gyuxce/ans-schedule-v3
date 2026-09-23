import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarRange, List as ListIcon } from 'lucide-react';
import { CLASS_LEVELS, CLASS_TYPES, DAYS_OF_WEEK } from '../constants';
import { formatDay, hoursBetween, toDateKey, weekDays } from '../lib/dates';
import { displayName, senseiRail, TYPE_TONE } from '../lib/display';
import { findMakeupsOf, hasActiveOrCompletedMakeup, isMakeupSession, makeupLabel } from '../lib/makeup';
import { addMinutesToTime } from '../lib/recurring';
import { findConflicts } from '../lib/schedule';
import { buildRecurringPreview, formatPreviewDate, previewConflicts } from '../lib/schedulePreview';
import { useDashboardStore, usePermissions, useScopedData } from '../store/useDashboardStore';
import type { CancellationInitiator, ClassSession, ClassType, SwapInitiator } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { DetailFields } from './ui/DetailFields';
import { Modal } from './ui/Modal';
import { PageIntro } from './ui/PageIntro';
import { StudentPicker } from './ui/StudentPicker';
import { WeekCalendar } from './ui/WeekCalendar';
import { WeekNav } from './ui/WeekNav';

const emptySessionForm = {
  senseiId: '',
  studentIds: [] as string[],
  type: 'Private' as ClassType,
  level: 'Guntai 1',
  date: toDateKey(new Date()),
  startTime: '09:00',
  endTime: '10:30',
  reason: '',
  makeupOfSessionId: null as string | null,
  classId: null as string | null,
  isExtra: false
};

const emptyRecurringForm = {
  displayName: '',
  senseiId: '',
  studentIds: [] as string[],
  type: 'Private' as ClassType,
  level: 'Pra Guntai',
  startDate: toDateKey(new Date()),
  weekdays: [1] as number[],
  startTime: '19:00',
  durationMinutes: 90,
  requiredMeetings: 10,
  acknowledgeConflicts: false
};

export function ScheduleView() {
  const permissions = usePermissions();
  const weekAnchor = useDashboardStore((state) => state.weekAnchor);
  const setWeekAnchor = useDashboardStore((state) => state.setWeekAnchor);
  const allSensei = useDashboardStore((state) => state.sensei);
  const allStudents = useDashboardStore((state) => state.students);
  const classMasters = useDashboardStore((state) => state.classMasters);
  const createClass = useDashboardStore((state) => state.createClass);
  const createRecurringOfficialClass = useDashboardStore((state) => state.createRecurringOfficialClass);
  const createExtraSession = useDashboardStore((state) => state.createExtraSession);
  const updateClass = useDashboardStore((state) => state.updateClass);
  const cancelClass = useDashboardStore((state) => state.cancelClass);
  const swapSensei = useDashboardStore((state) => state.swapSensei);
  const { schedules, sensei, students } = useScopedData();
  const days = weekDays(weekAnchor);
  const [editing, setEditing] = useState<ClassSession | null>(null);
  const [creatingRecurring, setCreatingRecurring] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionForm, setSessionForm] = useState(emptySessionForm);
  const [recurringForm, setRecurringForm] = useState(emptyRecurringForm);
  const [cancelReason, setCancelReason] = useState('');
  const [initiator, setInitiator] = useState<CancellationInitiator>('Admin');
  const [replacementSecured, setReplacementSecured] = useState(false);
  const [swapTo, setSwapTo] = useState('');
  const [swapInitiator, setSwapInitiator] = useState<SwapInitiator>('Admin');
  const [detailMode, setDetailMode] = useState<'view' | 'edit'>('view');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [senseiFilter, setSenseiFilter] = useState('all');

  const conflicts = useMemo(() => findConflicts(schedules), [schedules]);
  const conflictIds = new Set(conflicts.flatMap((pair) => [pair.a.id, pair.b.id]));

  const weekSessions = useMemo(() => {
    const keys = new Set(weekDays(weekAnchor).map((day) => toDateKey(day)));
    return schedules
      .filter((s) => keys.has(s.date) && (senseiFilter === 'all' || s.senseiId === senseiFilter))
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  }, [schedules, weekAnchor, senseiFilter]);

  const listByDay = useMemo(() => {
    const map = new Map<string, ClassSession[]>();
    for (const s of weekSessions) {
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return [...map.entries()];
  }, [weekSessions]);
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null);
  const conflictCursor = useRef(0);
  const cycleConflict = () => {
    if (!conflicts.length) return;
    const pair = conflicts[conflictCursor.current % conflicts.length];
    conflictCursor.current += 1;
    if (!days.some((day) => toDateKey(day) === pair.a.date)) setWeekAnchor(pair.a.date);
    setFocus((prev) => ({ id: pair.a.id, tick: (prev?.tick ?? 0) + 1 }));
  };

  const studentOptions = permissions.canViewAllSchedules ? allStudents : students;

  const preview = useMemo(
    () =>
      buildRecurringPreview({
        startDate: recurringForm.startDate,
        weekdays: recurringForm.weekdays,
        startTime: recurringForm.startTime,
        durationMinutes: recurringForm.durationMinutes,
        requiredMeetings: recurringForm.requiredMeetings
      }),
    [recurringForm]
  );

  const previewConflictList = useMemo(() => {
    if (!recurringForm.senseiId || recurringForm.studentIds.length === 0 || !preview.length) return [];
    return previewConflicts(
      schedules,
      preview,
      recurringForm.senseiId,
      recurringForm.studentIds,
      recurringForm.type,
      recurringForm.level
    );
  }, [schedules, preview, recurringForm]);

  const openRecurring = () => {
    setRecurringForm({
      ...emptyRecurringForm,
      senseiId: sensei[0]?.id ?? allSensei.find((item) => item.primaryStatus === 'ACTIVE')?.id ?? ''
    });
    setCreatingRecurring(true);
    setCreatingSession(false);
    setEditing(null);
  };

  const openMakeup = (session: ClassSession) => {
    setSessionForm({
      senseiId: session.senseiId,
      studentIds: session.studentIds,
      type: session.type,
      level: session.level,
      date: toDateKey(new Date()),
      startTime: session.startTime,
      endTime: session.endTime,
      reason: `Makeup untuk kelas ${session.date}`,
      makeupOfSessionId: session.id,
      classId: session.classId ?? null,
      isExtra: false
    });
    setCreatingSession(true);
    setCreatingRecurring(false);
    setEditing(null);
  };

  const openExtra = (session: ClassSession) => {
    if (!session.classId) {
      return;
    }
    setSessionForm({
      senseiId: session.senseiId,
      studentIds: session.studentIds,
      type: session.type,
      level: session.level,
      date: toDateKey(new Date()),
      startTime: session.startTime,
      endTime: session.endTime,
      reason: 'Extra meeting di luar rencana',
      makeupOfSessionId: null,
      classId: session.classId,
      isExtra: true
    });
    setCreatingSession(true);
    setCreatingRecurring(false);
    setEditing(null);
  };

  const openEdit = (session: ClassSession) => {
    setEditing(session);
    setCreatingRecurring(false);
    setCreatingSession(false);
    setDetailMode('view');
    setSessionForm({
      senseiId: session.senseiId,
      studentIds: session.studentIds,
      type: session.type,
      level: session.level,
      date: session.date,
      startTime: session.startTime,
      endTime: session.endTime,
      reason: '',
      makeupOfSessionId: session.makeupOfSessionId ?? null,
      classId: session.classId ?? null,
      isExtra: Boolean(session.isExtra)
    });
    setCancelReason('');
    setSwapTo('');
    setReplacementSecured(Boolean(session.replacementSecured));
  };

  const saveSession = () => {
    const payload = {
      senseiId: sessionForm.senseiId,
      studentIds: sessionForm.studentIds,
      type: sessionForm.type,
      level: sessionForm.level,
      date: sessionForm.date,
      startTime: sessionForm.startTime,
      endTime: sessionForm.endTime,
      makeupOfSessionId: creatingSession ? sessionForm.makeupOfSessionId : undefined,
      classId: sessionForm.classId,
      isExtra: sessionForm.isExtra
    };
    let ok = false;
    if (creatingSession && sessionForm.isExtra && sessionForm.classId) {
      ok = createExtraSession({ ...payload, classId: sessionForm.classId }, sessionForm.reason);
    } else if (creatingSession) {
      ok = createClass(payload, sessionForm.reason);
    } else if (editing) {
      ok = updateClass(editing.id, payload, sessionForm.reason || 'Koreksi jadwal resmi');
    }
    if (ok) {
      setCreatingSession(false);
      setEditing(null);
      setDetailMode('view');
    }
  };

  const saveRecurring = () => {
    const ok = createRecurringOfficialClass({
      ...recurringForm,
      acknowledgeConflicts: recurringForm.acknowledgeConflicts
    });
    if (ok) setCreatingRecurring(false);
  };

  const linkedMakeups = editing ? findMakeupsOf(editing.id, schedules) : [];
  const alreadyHasMakeup = editing ? hasActiveOrCompletedMakeup(editing.id, schedules) : false;
  const editingClass = editing?.classId
    ? classMasters.find((item) => item.id === editing.classId)
    : undefined;

  const setDurationFromStart = (startTime: string, endTime: string) => {
    setSessionForm((prev) => ({ ...prev, startTime, endTime }));
  };

  return (
    <div className="space-y-6">
      <PageIntro
        kicker="Jadwal Resmi"
        title="Kalender kelas"
        actions={
          <>
            {conflicts.length > 0 ? (
              <button
                type="button"
                onClick={cycleConflict}
                title={`${conflicts.length} konflik jadwal · klik untuk menuju bloknya`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 text-xs font-semibold text-danger"
              >
                <AlertTriangle size={14} />
                {conflicts.length} konflik
              </button>
            ) : null}
            <div className="inline-flex rounded-lg border border-line-strong p-0.5">
              <button
                type="button"
                onClick={() => setView('board')}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  view === 'board' ? 'bg-accent text-on-accent' : 'text-ink-soft hover:text-ink'
                }`}
              >
                <CalendarRange size={14} /> Board
              </button>
              <button
                type="button"
                onClick={() => setView('list')}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  view === 'list' ? 'bg-accent text-on-accent' : 'text-ink-soft hover:text-ink'
                }`}
              >
                <ListIcon size={14} /> List
              </button>
            </div>
            <select
              className="ui-select h-9 w-auto min-w-[150px]"
              value={senseiFilter}
              onChange={(event) => setSenseiFilter(event.target.value)}
            >
              <option value="all">Semua Sensei</option>
              {allSensei.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <WeekNav weekAnchor={weekAnchor} onChange={setWeekAnchor} />
            {permissions.canEditOfficialSchedule ? (
              <Button tone="primary" className="w-full sm:w-auto" onClick={openRecurring}>
                Kelas resmi baru
              </Button>
            ) : null}
          </>
        }
      >
        Kelas resmi = 1 Class Master + N sesi berulang. Makeup tertaut ke sesi batal; Extra meeting terpisah
        dari rencana.
      </PageIntro>
      {view === 'board' && senseiFilter !== 'all' ? (
        <>
          <p className="text-xs text-ink-soft lg:hidden">Geser ke samping untuk melihat jadwal mingguan.</p>
          <WeekCalendar
            days={days}
            sessions={weekSessions}
            sensei={allSensei}
            conflictIds={conflictIds}
            onSelect={openEdit}
            focus={focus}
          />
        </>
      ) : view === 'board' ? (
        <div className="ui-card overflow-hidden">
          <p className="border-b border-line px-4 py-2 text-[11px] text-ink-soft">
            Semua Sensei — agenda per hari. Pilih 1 Sensei untuk grid berbasis jam.
          </p>
          <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 lg:grid-cols-7 lg:divide-y-0">
            {days.map((day) => {
              const key = toDateKey(day);
              const rows = weekSessions.filter((s) => s.date === key);
              const isToday = key === toDateKey(new Date());
              return (
                <div key={key} className="min-w-0">
                  <div
                    className={`border-b px-2 py-2 text-center ${
                      isToday ? 'border-b-2 border-b-accent bg-accent-soft' : 'border-line'
                    }`}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                      {formatDay(day, 'EEE')}
                    </div>
                    <div className={`text-sm font-bold ${isToday ? 'text-accent' : 'text-ink'}`}>
                      {formatDay(day, 'd')}
                    </div>
                  </div>
                  <div className="min-h-[64px] space-y-1 p-1.5">
                    {rows.length === 0 ? (
                      <p className="px-1 py-2 text-center text-[10px] text-ink-faint">—</p>
                    ) : (
                      rows.map((s) => {
                        const conflict = conflictIds.has(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => openEdit(s)}
                            title={`${s.startTime}–${s.endTime} · ${s.level} · ${displayName(allSensei, s.senseiId)}`}
                            className={`flex w-full items-stretch gap-1.5 overflow-hidden rounded-md border text-left transition-colors hover:border-line-strong ${
                              conflict ? 'border-danger bg-danger-soft' : 'border-line bg-surface'
                            }`}
                          >
                            <span className={`w-1 shrink-0 ${senseiRail(s.senseiId)}`} />
                            <span className="min-w-0 py-1 pr-1.5">
                              <span className="block truncate text-[11px] font-semibold leading-tight text-ink">
                                {s.startTime} {s.level}
                              </span>
                              <span className="block truncate text-[10px] text-ink-soft">
                                {displayName(allSensei, s.senseiId)}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="ui-card divide-y divide-line overflow-hidden">
          {listByDay.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-soft">
              Tidak ada sesi pada minggu / filter ini.
            </p>
          ) : (
            listByDay.map(([date, rows]) => (
              <div key={date}>
                <div className="bg-surface-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {formatDay(date, 'EEEE, d MMM')} · {rows.length} sesi
                </div>
                <div className="divide-y divide-line">
                  {rows.map((s) => {
                    const conflict = conflictIds.has(s.id);
                    const mk = isMakeupSession(s);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => openEdit(s)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="w-24 shrink-0 text-xs tabular-nums text-ink-soft">
                          {s.startTime}–{s.endTime}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-ink">{s.level}</span>
                            <Badge tone={TYPE_TONE[s.type]}>{s.type}</Badge>
                            {s.status === 'cancelled' ? <Badge tone="danger">Batal</Badge> : null}
                            {conflict ? <Badge tone="danger">Konflik</Badge> : null}
                            {mk ? <Badge tone="sky">Makeup</Badge> : null}
                            {s.isExtra ? <Badge tone="gold">Extra</Badge> : null}
                          </span>
                          <span className="block truncate text-xs text-ink-soft">
                            {displayName(allSensei, s.senseiId)} · {s.studentIds.length} siswa
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {creatingRecurring && (
        <Modal
          wide
          title="Kelas resmi baru"
          onClose={() => setCreatingRecurring(false)}
          footer={
            permissions.canEditOfficialSchedule ? (
              <>
                <Button onClick={() => setCreatingRecurring(false)}>Tutup</Button>
                <Button tone="primary" onClick={saveRecurring}>
                  Save Class & Schedule
                </Button>
              </>
            ) : (
              <Button onClick={() => setCreatingRecurring(false)}>Tutup</Button>
            )
          }
        >
          <div className="space-y-4">
            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Informasi kelas</p>
              <label>
                <span className="ui-label">Nama kelas</span>
                <input
                  className="ui-input"
                  value={recurringForm.displayName}
                  placeholder="Private Nathan Pra Guntai"
                  onChange={(event) =>
                    setRecurringForm({ ...recurringForm, displayName: event.target.value })
                  }
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  <span className="ui-label">Sensei</span>
                  <select
                    className="ui-select"
                    value={recurringForm.senseiId}
                    onChange={(event) => setRecurringForm({ ...recurringForm, senseiId: event.target.value })}
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
                <label>
                  <span className="ui-label">Tipe kelas</span>
                  <select
                    className="ui-select"
                    value={recurringForm.type}
                    onChange={(event) =>
                      setRecurringForm({ ...recurringForm, type: event.target.value as ClassType })
                    }
                  >
                    {CLASS_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="ui-label">Level</span>
                  <select
                    className="ui-select"
                    value={recurringForm.level}
                    onChange={(event) => setRecurringForm({ ...recurringForm, level: event.target.value })}
                  >
                    {CLASS_LEVELS.map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div>
                <span className="ui-label">Siswa</span>
                <StudentPicker
                  students={studentOptions}
                  value={recurringForm.studentIds}
                  onChange={(studentIds) => setRecurringForm({ ...recurringForm, studentIds })}
                />
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Jadwal berulang</p>
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  <span className="ui-label">Start date</span>
                  <input
                    className="ui-input"
                    type="date"
                    value={recurringForm.startDate}
                    onChange={(event) =>
                      setRecurringForm({ ...recurringForm, startDate: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span className="ui-label">Start time</span>
                  <input
                    className="ui-input"
                    type="time"
                    value={recurringForm.startTime}
                    onChange={(event) =>
                      setRecurringForm({ ...recurringForm, startTime: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span className="ui-label">Duration (menit)</span>
                  <input
                    className="ui-input"
                    type="number"
                    min={30}
                    step={15}
                    value={recurringForm.durationMinutes}
                    onChange={(event) =>
                      setRecurringForm({
                        ...recurringForm,
                        durationMinutes: Number(event.target.value) || 90
                      })
                    }
                  />
                </label>
                <label>
                  <span className="ui-label">End time (otomatis)</span>
                  <input
                    className="ui-input"
                    type="time"
                    readOnly
                    value={addMinutesToTime(recurringForm.startTime, recurringForm.durationMinutes)}
                  />
                </label>
                <label>
                  <span className="ui-label">Total required meetings</span>
                  <input
                    className="ui-input"
                    type="number"
                    min={1}
                    value={recurringForm.requiredMeetings}
                    onChange={(event) =>
                      setRecurringForm({
                        ...recurringForm,
                        requiredMeetings: Math.max(1, Number(event.target.value) || 1)
                      })
                    }
                  />
                </label>
              </div>
              <div>
                <span className="ui-label">Recurring days</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day) => {
                    const checked = recurringForm.weekdays.includes(day.value);
                    return (
                      <label key={day.value} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setRecurringForm({
                              ...recurringForm,
                              weekdays: checked
                                ? recurringForm.weekdays.filter((value) => value !== day.value)
                                : [...recurringForm.weekdays, day.value]
                            })
                          }
                        />
                        {day.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Preview schedule</p>
              {preview.length === 0 ? (
                <p className="text-sm text-ink-soft">
                  Isi start date, hari, dan jumlah pertemuan untuk melihat preview.
                </p>
              ) : (
                <div className="max-h-56 overflow-auto rounded-xl border border-line">
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th>Date</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row) => (
                        <tr key={row.label}>
                          <td className="font-medium text-ink">{row.label}</td>
                          <td className="text-ink-soft">{formatPreviewDate(row.date)}</td>
                          <td className="tabular-nums text-ink-soft">
                            {row.startTime}–{row.endTime}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {previewConflictList.length > 0 ? (
                <div className="rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-ink">
                  <p className="font-semibold">
                    {previewConflictList.length} konflik dengan jadwal resmi Sensei yang sama.
                  </p>
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {previewConflictList.slice(0, 5).map((item) => (
                      <li key={`${item.date}-${item.startTime}-${item.withDate}`}>
                        {item.date} {item.startTime} bentrok dengan {item.withDate} {item.withStart}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={recurringForm.acknowledgeConflicts}
                      onChange={(event) =>
                        setRecurringForm({ ...recurringForm, acknowledgeConflicts: event.target.checked })
                      }
                    />
                    Saya paham konfliknya dan tetap simpan (tidak menimpa sesi lama)
                  </label>
                </div>
              ) : null}
            </section>
          </div>
        </Modal>
      )}

      {(creatingSession || editing) && (
        <Modal
          wide
          title={
            creatingSession
              ? sessionForm.isExtra
                ? 'Tambah extra meeting'
                : sessionForm.makeupOfSessionId
                  ? 'Jadwalkan makeup class'
                  : 'Sesi resmi'
              : 'Detail sesi resmi'
          }
          onClose={() => {
            setCreatingSession(false);
            setEditing(null);
            setDetailMode('view');
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setCreatingSession(false);
                  setEditing(null);
                  setDetailMode('view');
                }}
              >
                Tutup
              </Button>
              {editing && detailMode === 'view' && permissions.canEditOfficialSchedule ? (
                <Button tone="primary" onClick={() => setDetailMode('edit')}>
                  Ubah
                </Button>
              ) : null}
              {(creatingSession || (editing && detailMode === 'edit')) &&
              permissions.canEditOfficialSchedule ? (
                <>
                  {editing && detailMode === 'edit' ? (
                    <Button
                      onClick={() => {
                        openEdit(editing);
                      }}
                    >
                      Batal ubah
                    </Button>
                  ) : null}
                  <Button tone="primary" onClick={saveSession}>
                    Simpan
                  </Button>
                </>
              ) : null}
            </>
          }
        >
          {sessionForm.makeupOfSessionId && creatingSession ? (
            <p className="rounded-xl border border-info/25 bg-info-soft px-3 py-2 text-sm text-ink">
              Makeup tertaut ke sesi asli. Progress/absensi memakai sesi makeup, bukan sesi batal. Required
              meetings tidak naik.
            </p>
          ) : null}
          {sessionForm.isExtra && creatingSession ? (
            <p className="rounded-xl border border-warn/25 bg-warn-soft px-3 py-2 text-sm text-ink">
              Extra meeting di luar rencana. Tidak dihitung ke required X/X kecuali Admin mengubah total
              secara eksplisit.
            </p>
          ) : null}
          {editing && isMakeupSession(editing) ? (
            <p className="rounded-xl border border-info/25 bg-info-soft px-3 py-2 text-sm text-ink">
              {makeupLabel(editing, schedules)}
            </p>
          ) : null}
          {editing?.isExtra ? (
            <p className="rounded-xl border border-warn/25 bg-warn-soft px-3 py-2 text-sm text-ink">
              Sesi Extra — di luar required meetings.
            </p>
          ) : null}
          {editingClass ? (
            <p className="text-xs text-ink-soft">
              Class: {editingClass.displayName} · Original end {editingClass.plannedEndDate || '—'} ·
              Projected {editingClass.projectedEndDate || '—'}
            </p>
          ) : null}
          {editing && editing.status === 'cancelled' && linkedMakeups.length > 0 ? (
            <p className="rounded-xl bg-paper px-3 py-2 text-sm text-ink-soft">
              Makeup: {linkedMakeups.map((item) => `${item.date} ${item.startTime}`).join(', ')}
            </p>
          ) : null}

          {editing && detailMode === 'view' ? (
            <>
              <DetailFields
                items={[
                  { label: 'Status', value: editing.status },
                  { label: 'Sensei', value: displayName(allSensei, sessionForm.senseiId) },
                  { label: 'Tipe kelas', value: sessionForm.type },
                  { label: 'Level', value: sessionForm.level },
                  { label: 'Tanggal', value: sessionForm.date },
                  {
                    label: 'Waktu',
                    value: `${sessionForm.startTime} – ${sessionForm.endTime} (${hoursBetween(sessionForm.startTime, sessionForm.endTime)} jam)`
                  },
                  {
                    label: 'Siswa',
                    value:
                      sessionForm.studentIds
                        .map((id) => displayName(studentOptions, id))
                        .filter(Boolean)
                        .join(', ') || '—',
                    full: true
                  },
                  ...(editing.originalSenseiId
                    ? [
                        {
                          label: 'Riwayat swap',
                          value: `${displayName(allSensei, editing.originalSenseiId)} → ${displayName(allSensei, editing.senseiId)}${editing.swapInitiator ? ` · inisiatif ${editing.swapInitiator}` : ''}`,
                          full: true
                        },
                        {
                          label: 'Alasan swap',
                          value: editing.swapReason || '—',
                          full: true
                        }
                      ]
                    : []),
                  ...(editing.status === 'cancelled'
                    ? [
                        {
                          label: 'Alasan pembatalan',
                          value: `${editing.cancellationReason || '—'}${editing.cancellationInitiator ? ` · inisiatif ${editing.cancellationInitiator}` : ''}`,
                          full: true
                        }
                      ]
                    : [])
                ]}
              />
              {permissions.canEditOfficialSchedule && editing.classId ? (
                <div className="rounded-xl border border-warn/25 bg-warn-soft p-3">
                  <p className="ui-label">Extra meeting</p>
                  <p className="mb-2 text-xs text-ink-soft">
                    Tambah sesi di luar required meetings tanpa mengubah total rencana.
                  </p>
                  <Button tone="primary" onClick={() => openExtra(editing)}>
                    + Add Extra Meeting
                  </Button>
                </div>
              ) : null}
              {permissions.canEditOfficialSchedule && editing.status === 'cancelled' && !alreadyHasMakeup ? (
                <div className="rounded-xl border border-info/25 bg-info-soft p-3">
                  <p className="ui-label">Replacement / Makeup</p>
                  <p className="mb-2 text-xs text-ink-soft">
                    Buat sesi pengganti tertaut ke kelas batal ini.
                  </p>
                  <Button tone="primary" onClick={() => openMakeup(editing)}>
                    Jadwalkan makeup
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  <span className="ui-label">Sensei</span>
                  <select
                    className="ui-select"
                    value={sessionForm.senseiId}
                    onChange={(event) => setSessionForm({ ...sessionForm, senseiId: event.target.value })}
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
                <label>
                  <span className="ui-label">Tipe kelas</span>
                  <select
                    className="ui-select"
                    value={sessionForm.type}
                    onChange={(event) =>
                      setSessionForm({ ...sessionForm, type: event.target.value as ClassType })
                    }
                  >
                    {CLASS_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="ui-label">Level</span>
                  <select
                    className="ui-select"
                    value={sessionForm.level}
                    onChange={(event) => setSessionForm({ ...sessionForm, level: event.target.value })}
                  >
                    {CLASS_LEVELS.map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="ui-label">Tanggal</span>
                  <input
                    className="ui-input"
                    type="date"
                    value={sessionForm.date}
                    onChange={(event) => setSessionForm({ ...sessionForm, date: event.target.value })}
                  />
                </label>
                <label>
                  <span className="ui-label">Mulai</span>
                  <input
                    className="ui-input"
                    type="time"
                    value={sessionForm.startTime}
                    onChange={(event) => {
                      const startTime = event.target.value;
                      const duration = hoursBetween(sessionForm.startTime, sessionForm.endTime) * 60 || 90;
                      setDurationFromStart(startTime, addMinutesToTime(startTime, duration));
                    }}
                  />
                </label>
                <label>
                  <span className="ui-label">Selesai</span>
                  <input
                    className="ui-input"
                    type="time"
                    value={sessionForm.endTime}
                    onChange={(event) => setSessionForm({ ...sessionForm, endTime: event.target.value })}
                  />
                </label>
              </div>
              <div>
                <span className="ui-label">Siswa</span>
                <StudentPicker
                  students={studentOptions}
                  value={sessionForm.studentIds}
                  onChange={(studentIds) => setSessionForm({ ...sessionForm, studentIds })}
                />
              </div>
              <label>
                <span className="ui-label">Alasan perubahan (audit)</span>
                <input
                  className="ui-input"
                  value={sessionForm.reason}
                  onChange={(event) => setSessionForm({ ...sessionForm, reason: event.target.value })}
                  placeholder="Wajib untuk edit/swap/cancel"
                />
              </label>
              <p className="text-xs text-ink-soft">
                Durasi {hoursBetween(sessionForm.startTime, sessionForm.endTime)} jam. Ketersediaan Sensei
                hanya referensi kapasitas.
              </p>
              {editing && permissions.canAssignSensei && editing.status !== 'cancelled' ? (
                <div className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-2">
                  <div>
                    <p className="ui-label">Tukar Sensei</p>
                    <select
                      className="ui-select"
                      value={swapTo}
                      onChange={(event) => setSwapTo(event.target.value)}
                    >
                      <option value="">Pilih pengganti</option>
                      {allSensei
                        .filter((item) => item.id !== editing.senseiId && item.primaryStatus === 'ACTIVE')
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                    <select
                      className="ui-select mt-2"
                      value={swapInitiator}
                      onChange={(event) => setSwapInitiator(event.target.value as SwapInitiator)}
                    >
                      <option>Admin</option>
                      <option>Sensei</option>
                      <option>Student</option>
                    </select>
                    <Button
                      className="mt-2"
                      tone="primary"
                      disabled={!swapTo || !sessionForm.reason}
                      onClick={() => {
                        if (swapSensei(editing.id, swapTo, swapInitiator, sessionForm.reason)) {
                          setEditing(null);
                          setDetailMode('view');
                        }
                      }}
                    >
                      Simpan swap
                    </Button>
                  </div>
                  <div>
                    <p className="ui-label">Batalkan kelas</p>
                    <input
                      className="ui-input"
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      placeholder="Alasan pembatalan"
                    />
                    <select
                      className="ui-select mt-2"
                      value={initiator}
                      onChange={(event) => setInitiator(event.target.value as CancellationInitiator)}
                    >
                      <option>Admin</option>
                      <option>Sensei</option>
                      <option>Student</option>
                      <option>Ops</option>
                    </select>
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={replacementSecured}
                        onChange={(event) => setReplacementSecured(event.target.checked)}
                      />
                      Pengganti berhasil diamankan
                    </label>
                    <Button
                      className="mt-2"
                      tone="danger"
                      disabled={!cancelReason}
                      onClick={() => {
                        cancelClass(editing.id, { reason: cancelReason, initiator, replacementSecured });
                        setEditing(null);
                        setDetailMode('view');
                      }}
                    >
                      Batalkan kelas
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
