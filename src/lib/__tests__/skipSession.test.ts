import { describe, expect, it } from 'vitest';
import { buildActionItems } from '../actionCenter';
import { getClassProgress, getNotRunningStreak, getSessionOrdinal } from '../classProgress';
import { planSkipReplacement } from '../classSync';
import type { ClassMaster, ClassSession, SessionReport } from '../../types';

const teachingClass: ClassMaster = {
  id: 'c1',
  displayName: 'Private N5',
  type: 'Private',
  level: 'N5',
  senseiId: 's1',
  studentIds: ['st1'],
  requiredMeetings: 10,
  sessionDurationMinutes: 90,
  startDate: '2026-09-01',
  plannedEndDate: '2026-11-30',
  status: 'active'
};

const session = (id: string, date: string, extra: Partial<ClassSession> = {}): ClassSession => ({
  id,
  classId: 'c1',
  senseiId: 's1',
  studentIds: ['st1'],
  type: 'Private',
  level: 'N5',
  date,
  startTime: '19:00',
  endTime: '20:30',
  status: 'active',
  ...extra
});
const izin = (id: string, date: string) =>
  session(id, date, {
    status: 'cancelled',
    cancellationInitiator: 'Izin',
    cancellationReason: 'Siswa sakit'
  });
const report = (scheduleId: string, attendance: 'Present' | 'Excused' | 'Absent' = 'Present') =>
  ({ scheduleId, students: [{ studentId: 'st1', attendance }] }) as SessionReport;

describe('izin / loncat sesi numbering', () => {
  const schedules = [
    session('a', '2026-10-05', { status: 'completed' }),
    session('b', '2026-10-12', { status: 'completed' }),
    session('c', '2026-10-19', { status: 'completed' }),
    izin('d', '2026-10-26'),
    session('e', '2026-11-02'),
    session('f', '2026-11-09')
  ];

  it('3/10 becomes 4/11 when one session is skipped', () => {
    const progress = getClassProgress(teachingClass, schedules, []);
    expect(progress).toMatchObject({ completed: 3, skipped: 1, consumed: 4, totalSlots: 11, remaining: 7 });
  });

  it('keeps the skipped session in the numbering and moves the next one on', () => {
    const today = '2026-10-27';
    expect(getSessionOrdinal(schedules[3], schedules, teachingClass, [], today)?.label).toBe(
      'Sesi 4 dari 11'
    );
    expect(getSessionOrdinal(schedules[4], schedules, teachingClass, [], today)?.label).toBe(
      'Sesi 5 dari 11'
    );
  });

  it('does not count a skipped session as an unreported gap', () => {
    const ordinal = getSessionOrdinal(schedules[4], schedules, teachingClass, [], '2026-11-01');
    expect(ordinal?.unreportedBefore).toBe(0);
  });

  it('ordinary cancellations still leave the numbering untouched', () => {
    const plain = [
      session('a', '2026-10-05', { status: 'completed' }),
      session('b', '2026-10-12', { status: 'cancelled', cancellationInitiator: 'Student' }),
      session('c', '2026-10-19')
    ];
    expect(getClassProgress(teachingClass, plain, [])).toMatchObject({ skipped: 0, totalSlots: 10 });
    expect(getSessionOrdinal(plain[2], plain, teachingClass, [], '2026-10-20')?.label).toBe('Sesi 2 dari 10');
  });
});

describe('getNotRunningStreak', () => {
  const today = '2026-10-25';

  it('counts the most recent past sessions that did not run', () => {
    const schedules = [
      session('a', '2026-10-05', { status: 'completed' }),
      izin('b', '2026-10-12'),
      izin('c', '2026-10-19'),
      session('d', '2026-11-02')
    ];
    const result = getNotRunningStreak('c1', schedules, [report('a')], today);
    expect(result.streak).toBe(2);
    expect(result.sessions.map((item) => item.id)).toEqual(['c', 'b']);
  });

  it('ignores sessions cancelled as schedule corrections (neither counted nor breaking)', () => {
    const fix = (id: string, date: string) =>
      session(id, date, {
        status: 'cancelled',
        cancellationInitiator: 'Admin',
        cancellationReason: 'Salah pola hari'
      });
    const onlyFixes = [
      session('a', '2026-10-12', { status: 'completed' }),
      fix('b', '2026-10-19'),
      fix('c', '2026-10-22')
    ];
    expect(getNotRunningStreak('c1', onlyFixes, [report('a')], today).streak).toBe(0);
    const between = [
      izin('a', '2026-10-12'),
      fix('b', '2026-10-15'),
      izin('c', '2026-10-19'),
      fix('d', '2026-10-22')
    ];
    expect(getNotRunningStreak('c1', between, [], today).streak).toBe(2);
  });

  it('is broken by a session that ran', () => {
    const schedules = [
      izin('a', '2026-10-05'),
      session('b', '2026-10-12', { status: 'completed' }),
      izin('c', '2026-10-19')
    ];
    expect(getNotRunningStreak('c1', schedules, [report('b')], today).streak).toBe(1);
  });

  it('counts a session where every student was excused or absent', () => {
    const schedules = [
      session('a', '2026-10-12', { status: 'completed' }),
      session('b', '2026-10-19', { status: 'completed' })
    ];
    const reports = [report('a', 'Excused'), report('b', 'Absent')];
    expect(getNotRunningStreak('c1', schedules, reports, today).streak).toBe(2);
  });

  it('ignores upcoming and extra sessions and a past session with no report', () => {
    const schedules = [
      izin('a', '2026-10-19'),
      session('b', '2026-10-22'),
      session('x', '2026-10-23', { status: 'cancelled', isExtra: true }),
      izin('f', '2026-11-02')
    ];
    expect(getNotRunningStreak('c1', schedules, [], today).streak).toBe(0);
  });
});

describe('planSkipReplacement', () => {
  const createId = () => 'new';
  const base = (schedules: ClassSession[], target: ClassSession) =>
    planSkipReplacement({ schedules, session: target, senseiId: 's1', today: '2026-10-20', createId });

  it('adds the next weekly slot after the last session at the same time', () => {
    const schedules = [session('a', '2026-10-26'), session('b', '2026-11-02'), session('c', '2026-11-09')];
    const next = base(schedules, schedules[0]);
    expect(next).toMatchObject({
      date: '2026-11-16',
      startTime: '19:00',
      endTime: '20:30',
      status: 'active',
      classId: 'c1'
    });
  });

  it('follows a two-days-a-week pattern with each weekday own time', () => {
    const schedules = [
      session('a', '2026-10-26'),
      session('b', '2026-10-29', { startTime: '10:00', endTime: '11:30' }),
      session('c', '2026-11-02'),
      session('d', '2026-11-05', { startTime: '10:00', endTime: '11:30' })
    ];
    const next = base(schedules, schedules[0]);
    expect(next).toMatchObject({ date: '2026-11-09', startTime: '19:00' });
  });

  it('ignores an old weekday the class no longer uses', () => {
    const old = ['2026-09-05', '2026-09-12'].map((date, i) =>
      session(`old${i}`, date, { status: 'completed' })
    );
    const recent = ['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18'].map(
      (date, i) => session(`r${i}`, date)
    );
    const next = base([...old, ...recent], recent[2]);
    expect(next?.date).toBe('2026-11-25');
  });

  it('skips a day when the Sensei is already busy', () => {
    const schedules = [
      session('a', '2026-10-26'),
      session('b', '2026-11-02'),
      session('busy', '2026-11-09', {
        classId: 'other',
        studentIds: ['x'],
        startTime: '19:30',
        endTime: '21:00'
      })
    ];
    expect(base(schedules, schedules[0])?.date).toBe('2026-11-16');
  });

  it('returns null when no slot is free within four weeks', () => {
    const schedules = [
      session('a', '2026-10-26'),
      ...['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'].map((date) =>
        session(`busy-${date}`, date, { classId: 'other', studentIds: ['x'] })
      )
    ];
    expect(base(schedules, schedules[0])).toBeNull();
  });
});

describe('Action Center: class not running', () => {
  const now = new Date('2026-10-25T10:00:00');
  const run = (schedules: ClassSession[], classes = [teachingClass]) =>
    buildActionItems({
      sensei: [],
      schedules,
      availability: [],
      logs: [],
      reports: [],
      leavePeriods: [],
      classMasters: classes,
      weekAnchor: '2026-10-25',
      now
    }).filter((item) => item.kind === 'class_not_running');

  it('raises an item after two sessions in a row did not run', () => {
    const items = run([izin('a', '2026-10-12'), izin('b', '2026-10-19')]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ classId: 'c1', severity: 'medium' });
    expect(items[0]?.title).toContain('2x berturut-turut');
  });

  it('is high severity from three in a row', () => {
    const items = run([izin('a', '2026-10-05'), izin('b', '2026-10-12'), izin('c', '2026-10-19')]);
    expect(items[0]?.severity).toBe('high');
  });

  it('stays quiet for one miss, for old history and for inactive classes', () => {
    expect(run([session('a', '2026-10-12', { status: 'completed' }), izin('b', '2026-10-19')])).toHaveLength(
      0
    );
    expect(run([izin('a', '2026-08-01'), izin('b', '2026-08-08')])).toHaveLength(0);
    expect(
      run([izin('a', '2026-10-12'), izin('b', '2026-10-19')], [{ ...teachingClass, status: 'cancelled' }])
    ).toHaveLength(0);
  });
});
