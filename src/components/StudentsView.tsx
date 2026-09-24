import { useMemo, useState } from 'react';
import {
  CLASS_LEVELS,
  CLASS_TYPES,
  ENROLLMENT_STATUS_LABEL,
  ENROLLMENT_STATUSES,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUSES
} from '../constants';
import { ATTENDANCE_TONE, displayName } from '../lib/display';
import {
  deriveEnrollmentDisplayStatus,
  getEnrollmentProgress,
  isCurrentEnrollmentStatus
} from '../lib/enrollment';
import { formatDay } from '../lib/dates';
import { filterAcademicReportRows, isMakeupSession, makeupLabel } from '../lib/makeup';
import { senseiDisplayName } from '../lib/labels';
import { useDashboardStore, usePermissions, useScopedData } from '../store/useDashboardStore';
import type { ClassType, Enrollment, EnrollmentStatus, PaymentStatus, Student } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Avatar } from './ui/Avatar';
import { ConfirmDelete } from './ui/ConfirmDelete';
import { FilterChips } from './ui/FilterChips';
import { Meter } from './ui/Meter';
import { Modal } from './ui/Modal';
import { PageIntro } from './ui/PageIntro';
import { ProgressRing } from './ui/ProgressRing';

const emptyStudent = (): Omit<Student, 'id'> => ({
  name: '',
  email: '',
  phone: '',
  type: 'Private',
  currentLevel: '',
  startingLevel: '',
  isActive: true,
  academicNotes: ''
});

const emptyEnrollment = (studentId: string): Omit<Enrollment, 'id' | 'updatedAt' | 'updatedBy'> => ({
  studentId,
  level: CLASS_LEVELS[0] || 'N5',
  classType: 'Private',
  classId: null,
  senseiId: null,
  status: 'active',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: null,
  plannedEndDate: null,
  requiredMeetings: null,
  sessionsCompleted: 0,
  paymentStatus: 'BELUM_BAYAR',
  paymentRemark: '',
  enrollmentRemark: '',
  notes: ''
});

export function StudentsView() {
  const permissions = usePermissions();
  const allSensei = useDashboardStore((state) => state.sensei);
  const classMasters = useDashboardStore((state) => state.classMasters);
  const levelCompletions = useDashboardStore((state) => state.levelCompletions);
  const enrollments = useDashboardStore((state) => state.enrollments);
  const completeLevel = useDashboardStore((state) => state.completeLevel);
  const upsertStudent = useDashboardStore((state) => state.upsertStudent);
  const deleteStudent = useDashboardStore((state) => state.deleteStudent);
  const upsertEnrollment = useDashboardStore((state) => state.upsertEnrollment);
  const { students, sessionReports, schedules } = useScopedData();
  const canManage = permissions.canManageUsers;
  const [selectedId, setSelectedId] = useState(students[0]?.id ?? '');
  const selected = students.find((item) => item.id === selectedId) ?? students[0];
  const [nextLevel, setNextLevel] = useState('');
  const [notes, setNotes] = useState('');
  const [studentModal, setStudentModal] = useState(false);
  const [studentForm, setStudentForm] = useState(emptyStudent());
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [enrollmentModal, setEnrollmentModal] = useState(false);
  const [enrollmentForm, setEnrollmentForm] = useState(emptyEnrollment(''));
  const [editingEnrollmentId, setEditingEnrollmentId] = useState<string | null>(null);
  const [studentQuery, setStudentQuery] = useState('');
  const [listFilter, setListFilter] = useState<'active' | 'ending' | 'inactive' | 'all'>('active');

  /** current enrollment + "mau habis" status per student */
  const studentRows = useMemo(() => {
    return students.map((student) => {
      const current = enrollments.find(
        (item) => item.studentId === student.id && isCurrentEnrollmentStatus(item.status)
      );
      const display = current ? deriveEnrollmentDisplayStatus(current, schedules, sessionReports) : null;
      const ending = display === 'ending_soon' || current?.status === 'ending_soon';
      const progress = current ? getEnrollmentProgress(current, schedules, sessionReports) : null;
      return {
        student,
        ending: Boolean(ending && student.isActive),
        remaining: progress?.remaining ?? null,
        plannedEnd: current?.plannedEndDate ?? null
      };
    });
  }, [students, enrollments, schedules, sessionReports]);

  const endingCount = studentRows.filter((r) => r.ending).length;

  const history = useMemo(() => {
    if (!selected) return [];
    const rows = sessionReports
      .flatMap((report) => {
        const record = report.students.find((item) => item.studentId === selected.id);
        const session = schedules.find((item) => item.id === report.scheduleId);
        if (!record || !session) return [];
        return [{ report, record, session }];
      })
      .sort((a, b) => b.session.date.localeCompare(a.session.date));
    return filterAcademicReportRows(rows, schedules);
  }, [selected, sessionReports, schedules]);

  const attendanceRate = history.length
    ? history.filter((item) => item.record.attendance === 'Present' || item.record.attendance === 'Late')
        .length / history.length
    : null;

  const studentCompletions = selected
    ? levelCompletions.filter((item) => item.studentId === selected.id)
    : [];
  const currentLevelCompleted = selected
    ? studentCompletions.some((item) => item.level === selected.currentLevel)
    : false;

  const studentEnrollments = useMemo(() => {
    if (!selected) return [];
    return enrollments
      .filter((item) => item.studentId === selected.id)
      .sort((a, b) => {
        const aKey = a.startDate || a.updatedAt || '';
        const bKey = b.startDate || b.updatedAt || '';
        return bKey.localeCompare(aKey);
      });
  }, [enrollments, selected]);

  const currentEnrollment = studentEnrollments.find((item) => isCurrentEnrollmentStatus(item.status));
  const learningHistory = studentEnrollments.filter((item) => !isCurrentEnrollmentStatus(item.status));

  const currentProgress = currentEnrollment
    ? getEnrollmentProgress(currentEnrollment, schedules, sessionReports)
    : null;
  const currentDisplayStatus = currentEnrollment
    ? deriveEnrollmentDisplayStatus(currentEnrollment, schedules, sessionReports)
    : null;

  const openCreateStudent = () => {
    setEditingStudentId(null);
    setStudentForm(emptyStudent());
    setStudentModal(true);
  };

  const openEditStudent = () => {
    if (!selected) return;
    setEditingStudentId(selected.id);
    setStudentForm({
      name: selected.name,
      email: selected.email || '',
      phone: selected.phone || '',
      type: selected.type,
      currentLevel: selected.currentLevel,
      startingLevel: selected.startingLevel,
      senseiId: selected.senseiId,
      isActive: selected.isActive,
      academicNotes: selected.academicNotes || ''
    });
    setStudentModal(true);
  };

  const startEnrollmentEdit = (item: Enrollment) => {
    setEditingEnrollmentId(item.id);
    setEnrollmentForm({
      studentId: item.studentId,
      level: item.level,
      classType: item.classType || 'Private',
      classId: item.classId || null,
      senseiId: item.senseiId || null,
      status: item.status,
      startDate: item.startDate || null,
      endDate: item.endDate || null,
      plannedEndDate: item.plannedEndDate || null,
      requiredMeetings: item.requiredMeetings ?? null,
      sessionsCompleted: item.sessionsCompleted ?? 0,
      paymentStatus: item.paymentStatus || 'BELUM_BAYAR',
      paymentRemark: item.paymentRemark || '',
      enrollmentRemark: item.enrollmentRemark || '',
      notes: item.notes || ''
    });
    setEnrollmentModal(true);
  };

  const startEnrollmentCreate = () => {
    if (!selected) return;
    setEditingEnrollmentId(null);
    setEnrollmentForm(emptyEnrollment(selected.id));
    setEnrollmentModal(true);
  };

  return (
    <div className="space-y-6">
      <PageIntro
        kicker="Akademik Siswa"
        title="Siswa"
        actions={
          canManage ? (
            <Button tone="primary" className="w-full sm:w-auto" onClick={openCreateStudent}>
              + Tambah Siswa
            </Button>
          ) : null
        }
      >
        Profil siswa adalah master permanen. Level/kelas disimpan di Enrollment / Learning Journey (history
        tidak di-overwrite).
      </PageIntro>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr] lg:items-start">
        <div className="ui-card overflow-hidden lg:sticky lg:top-4">
          <div className="space-y-2 border-b border-line px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-semibold">Siswa operasional</div>
              <span className="text-[11px] text-ink-soft">
                {students.filter((s) => s.isActive).length} aktif · {students.length} total
              </span>
            </div>
            <input
              className="ui-input h-9"
              placeholder="Cari nama"
              value={studentQuery}
              onChange={(event) => setStudentQuery(event.target.value)}
            />
            <FilterChips
              value={listFilter}
              onChange={setListFilter}
              options={[
                { id: 'active', label: 'Aktif', count: students.filter((s) => s.isActive).length },
                { id: 'ending', label: 'Mau habis', count: endingCount },
                {
                  id: 'inactive',
                  label: 'Nonaktif',
                  count: students.filter((s) => !s.isActive).length
                },
                { id: 'all', label: 'Semua', count: students.length }
              ]}
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto lg:max-h-[calc(100vh-16rem)]">
            {studentRows
              .filter(({ student, ending }) => {
                if (student.id === selectedId) return true;
                if (listFilter === 'active' && !student.isActive) return false;
                if (listFilter === 'inactive' && student.isActive) return false;
                if (listFilter === 'ending' && !ending) return false;
                const q = studentQuery.trim().toLowerCase();
                if (!q) return true;
                return `${student.name} ${student.currentLevel} ${student.type}`.toLowerCase().includes(q);
              })
              .slice()
              .sort((a, b) => {
                if (a.ending !== b.ending) return a.ending ? -1 : 1;
                if (a.ending && b.ending) return (a.remaining ?? 99) - (b.remaining ?? 99);
                return Number(b.student.isActive) - Number(a.student.isActive);
              })
              .map(({ student, ending, remaining, plannedEnd }) => (
                <button
                  key={student.id}
                  onClick={() => {
                    setSelectedId(student.id);
                    setNextLevel('');
                    setNotes('');
                  }}
                  className={`flex w-full items-center gap-3 border-b border-l-2 border-line px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                    selectedId === student.id
                      ? 'border-l-accent bg-accent-soft'
                      : ending
                        ? 'border-l-warn bg-surface hover:bg-surface-2'
                        : 'border-l-transparent bg-surface hover:bg-surface-2'
                  } ${!student.isActive ? 'opacity-55' : ''}`}
                >
                  <Avatar name={student.name} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{student.name}</span>
                      {ending ? (
                        <span className="shrink-0 text-[10px] font-semibold uppercase text-warn">
                          mau habis
                        </span>
                      ) : !student.isActive ? (
                        <span className="shrink-0 text-[10px] font-medium uppercase text-ink-faint">
                          nonaktif
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-ink-soft">
                      {ending
                        ? remaining != null
                          ? `sisa ${remaining} sesi`
                          : plannedEnd
                            ? `berakhir ${formatDay(plannedEnd, 'd MMM')}`
                            : 'mendekati akhir'
                        : `${student.currentLevel || 'Belum ada enrollment'} · ${student.type}`}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>

        {selected ? (
          <div className="space-y-4">
            <div className="ui-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-4">
                  <Avatar name={selected.name} size="lg" />
                  <div>
                    <h3 className="text-xl font-semibold sm:text-2xl">{selected.name}</h3>
                    <p className="text-sm text-ink-soft">
                      {selected.phone ? `WA ${selected.phone}` : 'Tanpa WA'}
                      {selected.email ? ` · ${selected.email}` : ''}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                      Starting level: {selected.startingLevel || '—'} · Sensei profil{' '}
                      {displayName(allSensei, selected.senseiId)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentDisplayStatus === 'ending_soon' ? <Badge tone="gold">Ending Soon</Badge> : null}
                  {currentLevelCompleted ? <Badge tone="success">Level completed</Badge> : null}
                  <Badge tone={selected.isActive ? 'success' : 'muted'}>
                    {selected.isActive ? 'Aktif' : 'Tidak aktif'}
                  </Badge>
                  {canManage ? <Button onClick={openEditStudent}>Edit profil</Button> : null}
                </div>
              </div>
              {selected.academicNotes ? (
                <p className="mt-3 text-sm text-ink-soft">Catatan: {selected.academicNotes}</p>
              ) : null}

              <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-center">
                <ProgressRing
                  value={currentProgress?.completed ?? 0}
                  max={currentProgress?.required || 10}
                  hint="sesi"
                />
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold uppercase tracking-wide text-ink-soft">
                        Hadir / terlambat
                      </span>
                      <span className="font-semibold text-ink">
                        {attendanceRate === null ? '—' : `${Math.round(attendanceRate * 100)}%`}
                      </span>
                    </div>
                    <Meter className="mt-1.5" value={attendanceRate ?? 0} tone="pine" />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                      Learning journey
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {[...learningHistory].reverse().map((item) => (
                        <span
                          key={item.id}
                          className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-soft"
                        >
                          {item.level}
                        </span>
                      ))}
                      {currentEnrollment ? (
                        <span className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent">
                          {currentEnrollment.level}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-soft">Belum ada enrollment aktif</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-ink-soft">
                    {history.length} sesi tercatat (tanpa double-count makeup)
                  </p>
                </div>
              </div>
            </div>

            <div className="ui-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-ink">Current Enrollment</p>
                {canManage ? (
                  <Button tone="primary" onClick={startEnrollmentCreate}>
                    + Add New Enrollment / Next Level
                  </Button>
                ) : null}
              </div>
              {currentEnrollment ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={currentDisplayStatus === 'ending_soon' ? 'gold' : 'success'}>
                      {ENROLLMENT_STATUS_LABEL[currentDisplayStatus || currentEnrollment.status]}
                    </Badge>
                    <span className="font-semibold">{currentEnrollment.level}</span>
                    {currentEnrollment.classType ? (
                      <span className="text-ink-soft">· {currentEnrollment.classType}</span>
                    ) : null}
                    {currentEnrollment.paymentStatus ? (
                      <Badge>{PAYMENT_STATUS_LABEL[currentEnrollment.paymentStatus]}</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-ink-soft">
                    Mulai {currentEnrollment.startDate || '—'}
                    {currentEnrollment.plannedEndDate
                      ? ` · Planned end ${currentEnrollment.plannedEndDate}`
                      : ''}
                    {currentEnrollment.senseiId
                      ? ` · Sensei ${displayName(allSensei, currentEnrollment.senseiId)}`
                      : ''}
                  </p>
                  {currentEnrollment.classId ? (
                    <p className="text-xs text-ink-soft">
                      Kelas:{' '}
                      {classMasters.find((item) => item.id === currentEnrollment.classId)?.displayName ||
                        currentEnrollment.classId.slice(0, 8)}
                    </p>
                  ) : null}
                  {currentProgress && currentProgress.required > 0 ? (
                    <div className="max-w-sm">
                      <p className="text-xs font-semibold text-ink">
                        Sesi {currentProgress.completed} / {currentProgress.required}
                        {currentDisplayStatus === 'ending_soon' ? ' · Ending Soon' : ''}
                      </p>
                      <Meter
                        className="mt-1.5"
                        value={currentProgress.completed}
                        max={currentProgress.required}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-warn">
                      Target sesi belum diisi — buka <b>Edit enrollment</b>, pilih <b>Assigned class</b> atau
                      isi <b>Required total meetings</b> agar progres &amp; "mau habis" terhitung.
                    </p>
                  )}
                  {currentEnrollment.enrollmentRemark || currentEnrollment.notes ? (
                    <p className="text-xs text-ink-soft">
                      {currentEnrollment.enrollmentRemark || currentEnrollment.notes}
                    </p>
                  ) : null}
                  {canManage ? (
                    <Button onClick={() => startEnrollmentEdit(currentEnrollment)}>Edit enrollment</Button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-soft">Belum ada enrollment aktif.</p>
              )}
            </div>

            {learningHistory.length > 0 ? (
              <div className="ui-card overflow-hidden">
                <div className="border-b border-line px-4 py-3 font-semibold">Learning History</div>
                <ul className="divide-y divide-line text-sm">
                  {learningHistory.map((item) => (
                    <li key={item.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={item.status === 'completed' ? 'success' : 'muted'}>
                          {ENROLLMENT_STATUS_LABEL[item.status]}
                        </Badge>
                        <span className="font-semibold">{item.level}</span>
                        {item.classType ? <span className="text-ink-soft">· {item.classType}</span> : null}
                        {item.paymentStatus ? (
                          <span className="text-xs text-ink-soft">
                            {PAYMENT_STATUS_LABEL[item.paymentStatus]}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-ink-soft">
                        {item.startDate || '—'} → {item.endDate || '—'}
                        {item.senseiId ? ` · ${displayName(allSensei, item.senseiId)}` : ''}
                        {item.classId
                          ? ` · ${classMasters.find((c) => c.id === item.classId)?.displayName || 'kelas'}`
                          : ''}
                      </div>
                      {item.enrollmentRemark || item.notes ? (
                        <div className="text-xs text-ink-soft">{item.enrollmentRemark || item.notes}</div>
                      ) : null}
                      {canManage ? (
                        <button
                          className="mt-1 text-xs font-semibold text-accent"
                          onClick={() => startEnrollmentEdit(item)}
                        >
                          Edit
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {permissions.canOverrideAcademic ? (
              <div className="ui-card space-y-3 p-4">
                <div>
                  <p className="font-semibold text-ink">Tandai level selesai</p>
                  <p className="text-xs text-ink-soft">
                    Menutup enrollment level saat ini dan (opsional) membuka enrollment level baru.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <p className="ui-label">Level yang diselesaikan</p>
                    <input className="ui-input" value={selected.currentLevel} disabled />
                  </div>
                  <label>
                    <span className="ui-label">Naik ke level (opsional)</span>
                    <select
                      className="ui-select"
                      value={nextLevel}
                      onChange={(e) => setNextLevel(e.target.value)}
                    >
                      <option value="">Tetap di level ini</option>
                      {CLASS_LEVELS.filter((level) => level !== selected.currentLevel).map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-end">
                    <Button
                      tone="primary"
                      className="w-full md:w-auto"
                      disabled={currentLevelCompleted || !selected.currentLevel}
                      onClick={() => {
                        const ok = completeLevel({
                          studentId: selected.id,
                          level: selected.currentLevel,
                          nextLevel: nextLevel || null,
                          notes: notes || undefined
                        });
                        if (ok) {
                          setNotes('');
                          setNextLevel('');
                        }
                      }}
                    >
                      Complete level
                    </Button>
                  </div>
                </div>
                <input
                  className="ui-input"
                  placeholder="Catatan akademik (opsional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            ) : null}

            <div className="ui-card overflow-hidden">
              <div className="border-b border-line px-4 py-3 font-semibold">Riwayat sesi</div>
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Absensi</th>
                      <th className="num">Nilai</th>
                      <th>Materi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr>
                        <td className="text-ink-soft" colSpan={4}>
                          Belum ada riwayat sesi.
                        </td>
                      </tr>
                    ) : (
                      history.map(({ report, record, session }) => (
                        <tr key={report.id}>
                          <td className="whitespace-nowrap">
                            <div className="tabular-nums text-ink">{session.date}</div>
                            {isMakeupSession(session) ? (
                              <div className="text-[11px] text-info">{makeupLabel(session, schedules)}</div>
                            ) : null}
                          </td>
                          <td>
                            <Badge tone={ATTENDANCE_TONE[record.attendance]}>{record.attendance}</Badge>
                          </td>
                          <td className="num text-ink">{record.performanceScore ?? '—'}</td>
                          <td className="text-ink-soft">{report.materialCovered}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {studentModal ? (
        <Modal
          title={editingStudentId ? 'Edit profil siswa' : 'Tambah Siswa'}
          onClose={() => setStudentModal(false)}
          footer={
            <>
              <Button onClick={() => setStudentModal(false)}>Batal</Button>
              <Button
                tone="primary"
                onClick={() => {
                  const id = upsertStudent({
                    ...studentForm,
                    id: editingStudentId || undefined,
                    email: studentForm.email || undefined,
                    phone: studentForm.phone || undefined,
                    academicNotes: studentForm.academicNotes || undefined
                  });
                  if (id) {
                    setSelectedId(id);
                    setStudentModal(false);
                  }
                }}
              >
                Simpan
              </Button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="ui-label">Nama</span>
              <input
                className="ui-input"
                value={studentForm.name}
                onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
              />
            </label>
            <label>
              <span className="ui-label">WhatsApp / kontak</span>
              <input
                className="ui-input"
                value={studentForm.phone || ''}
                onChange={(e) => setStudentForm({ ...studentForm, phone: e.target.value })}
              />
            </label>
            <label>
              <span className="ui-label">Email</span>
              <input
                className="ui-input"
                type="email"
                value={studentForm.email || ''}
                onChange={(e) => setStudentForm({ ...studentForm, email: e.target.value })}
              />
            </label>
            <label>
              <span className="ui-label">Starting level (referensi)</span>
              <select
                className="ui-select"
                value={studentForm.startingLevel}
                onChange={(e) =>
                  setStudentForm({
                    ...studentForm,
                    startingLevel: e.target.value,
                    currentLevel: studentForm.currentLevel || e.target.value
                  })
                }
              >
                <option value="">—</option>
                {CLASS_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ui-label">Tipe default (referensi)</span>
              <select
                className="ui-select"
                value={studentForm.type}
                onChange={(e) => setStudentForm({ ...studentForm, type: e.target.value as ClassType })}
              >
                {CLASS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ui-label">Status siswa</span>
              <select
                className="ui-select"
                value={studentForm.isActive ? 'active' : 'inactive'}
                onChange={(e) => setStudentForm({ ...studentForm, isActive: e.target.value === 'active' })}
              >
                <option value="active">Aktif</option>
                <option value="inactive">Tidak aktif</option>
              </select>
            </label>
            <label className="md:col-span-2">
              <span className="ui-label">Catatan akademik / internal</span>
              <textarea
                className="ui-textarea"
                value={studentForm.academicNotes || ''}
                onChange={(e) => setStudentForm({ ...studentForm, academicNotes: e.target.value })}
              />
            </label>
          </div>

          {editingStudentId && canManage ? (
            <div className="mt-3 flex flex-col items-start gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-ink-soft">
                Hapus permanen — hanya untuk siswa yang salah input (belum ada enrollment / jadwal / laporan).
                Kalau sudah punya data, pakai status <b>Tidak aktif</b>.
              </span>
              <ConfirmDelete
                label="Hapus"
                confirmLabel="Hapus siswa"
                message={`Hapus ${selected?.name ?? 'siswa ini'}?`}
                onConfirm={async () => {
                  const ok = await deleteStudent(editingStudentId);
                  if (ok) setStudentModal(false);
                }}
              />
            </div>
          ) : null}
        </Modal>
      ) : null}

      {enrollmentModal ? (
        <Modal
          wide
          title={editingEnrollmentId ? 'Edit Enrollment' : 'Add New Enrollment / Next Level'}
          onClose={() => setEnrollmentModal(false)}
          footer={
            <>
              <Button onClick={() => setEnrollmentModal(false)}>Batal</Button>
              <Button
                tone="primary"
                onClick={() => {
                  const id = upsertEnrollment({
                    ...enrollmentForm,
                    id: editingEnrollmentId || undefined,
                    paymentRemark: enrollmentForm.paymentRemark || undefined,
                    enrollmentRemark: enrollmentForm.enrollmentRemark || undefined,
                    notes: enrollmentForm.notes || undefined
                  });
                  if (id) setEnrollmentModal(false);
                }}
              >
                Simpan enrollment
              </Button>
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <span className="ui-label">Level / program</span>
              <select
                className="ui-select"
                value={enrollmentForm.level}
                onChange={(e) => setEnrollmentForm({ ...enrollmentForm, level: e.target.value })}
              >
                {CLASS_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ui-label">Class type</span>
              <select
                className="ui-select"
                value={enrollmentForm.classType || 'Private'}
                onChange={(e) =>
                  setEnrollmentForm({ ...enrollmentForm, classType: e.target.value as ClassType })
                }
              >
                {CLASS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ui-label">Assigned class</span>
              <select
                className="ui-select"
                value={enrollmentForm.classId || ''}
                onChange={(e) => {
                  const classId = e.target.value || null;
                  const teachingClass = classMasters.find((item) => item.id === classId);
                  setEnrollmentForm({
                    ...enrollmentForm,
                    classId,
                    senseiId: teachingClass?.senseiId || enrollmentForm.senseiId,
                    classType: teachingClass?.type || enrollmentForm.classType,
                    level: teachingClass?.level || enrollmentForm.level,
                    requiredMeetings: teachingClass?.requiredMeetings ?? enrollmentForm.requiredMeetings,
                    plannedEndDate: teachingClass?.plannedEndDate ?? enrollmentForm.plannedEndDate
                  });
                }}
              >
                <option value="">—</option>
                {classMasters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {item.level}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ui-label">Assigned Sensei</span>
              <select
                className="ui-select"
                value={enrollmentForm.senseiId || ''}
                onChange={(e) => setEnrollmentForm({ ...enrollmentForm, senseiId: e.target.value || null })}
              >
                <option value="">—</option>
                {allSensei.map((item) => (
                  <option key={item.id} value={item.id}>
                    {senseiDisplayName(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ui-label">Start date</span>
              <input
                className="ui-input"
                type="date"
                value={enrollmentForm.startDate || ''}
                onChange={(e) => setEnrollmentForm({ ...enrollmentForm, startDate: e.target.value || null })}
              />
            </label>
            <label>
              <span className="ui-label">Original planned end</span>
              <input
                className="ui-input"
                type="date"
                value={enrollmentForm.plannedEndDate || ''}
                onChange={(e) =>
                  setEnrollmentForm({ ...enrollmentForm, plannedEndDate: e.target.value || null })
                }
              />
            </label>
            <label>
              <span className="ui-label">Required total meetings</span>
              <input
                className="ui-input"
                type="number"
                min={1}
                placeholder="ikut Assigned class"
                value={enrollmentForm.requiredMeetings ?? ''}
                onChange={(e) =>
                  setEnrollmentForm({ ...enrollmentForm, requiredMeetings: Number(e.target.value) || null })
                }
              />
            </label>
            <label>
              <span className="ui-label">Sessions completed</span>
              <input
                className="ui-input"
                type="number"
                min={0}
                value={enrollmentForm.sessionsCompleted ?? 0}
                onChange={(e) =>
                  setEnrollmentForm({ ...enrollmentForm, sessionsCompleted: Number(e.target.value) || 0 })
                }
              />
            </label>
            <label>
              <span className="ui-label">Payment status</span>
              <select
                className="ui-select"
                value={enrollmentForm.paymentStatus || 'BELUM_BAYAR'}
                onChange={(e) =>
                  setEnrollmentForm({ ...enrollmentForm, paymentStatus: e.target.value as PaymentStatus })
                }
              >
                {PAYMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {PAYMENT_STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ui-label">Enrollment status</span>
              <select
                className="ui-select"
                value={enrollmentForm.status}
                onChange={(e) =>
                  setEnrollmentForm({ ...enrollmentForm, status: e.target.value as EnrollmentStatus })
                }
              >
                {ENROLLMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {ENROLLMENT_STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-2">
              <span className="ui-label">Payment remark</span>
              <input
                className="ui-input"
                value={enrollmentForm.paymentRemark || ''}
                onChange={(e) => setEnrollmentForm({ ...enrollmentForm, paymentRemark: e.target.value })}
              />
            </label>
            <label className="md:col-span-2">
              <span className="ui-label">Enrollment remark</span>
              <textarea
                className="ui-textarea"
                value={enrollmentForm.enrollmentRemark || ''}
                onChange={(e) => setEnrollmentForm({ ...enrollmentForm, enrollmentRemark: e.target.value })}
              />
            </label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
