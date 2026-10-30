import { describe, expect, it } from 'vitest';
import {
  countEnrollmentSessionsCompleted,
  deriveEnrollmentDisplayStatus,
  ensureClassEnrollments,
  isEnrollmentStale,
  pickCurrentEnrollment
} from '../enrollment';
import type { ClassMaster, ClassSession, Enrollment, SessionReport } from '../../types';

const enrollment: Enrollment = {
  id: 'e1',
  studentId: 'st1',
  classId: 'c1',
  level: 'Guntai 3',
  status: 'active',
  paymentStatus: 'BELUM_BAYAR',
  requiredMeetings: 17,
  sessionsCompleted: 0
} as Enrollment;

const session = (id: string, extra: Partial<ClassSession> = {}): ClassSession => ({
  id,
  classId: 'c1',
  senseiId: 's1',
  studentIds: ['st1'],
  type: 'Private',
  level: 'Guntai 5',
  date: '2026-10-12',
  startTime: '15:00',
  endTime: '16:30',
  status: 'completed',
  ...extra
});
const report = (scheduleId: string) => ({ scheduleId }) as SessionReport;

describe('countEnrollmentSessionsCompleted', () => {
  it('counts sessions of the linked class even when their level label differs from the enrollment', () => {
    const schedules = [session('a'), session('b'), session('c', { status: 'active' })];
    expect(countEnrollmentSessionsCompleted(enrollment, schedules, [report('c')])).toBe(3);
  });

  it('does not count sessions of another class, cancelled ones, or other students', () => {
    const schedules = [
      session('a', { classId: 'other' }),
      session('b', { status: 'cancelled' }),
      session('c', { studentIds: ['st2'] }),
      session('d')
    ];
    expect(countEnrollmentSessionsCompleted(enrollment, schedules, [])).toBe(1);
  });

  it('still matches on level for sessions that are not tied to a class', () => {
    const schedules = [
      session('a', { classId: null, level: 'Guntai 3' }),
      session('b', { classId: null, level: 'Guntai 5' })
    ];
    expect(countEnrollmentSessionsCompleted(enrollment, schedules, [])).toBe(1);
  });

  it('keeps the stored value when it is higher than what the sessions show', () => {
    expect(
      countEnrollmentSessionsCompleted({ ...enrollment, sessionsCompleted: 6 }, [session('a')], [])
    ).toBe(6);
  });
});

describe('pickCurrentEnrollment / isEnrollmentStale', () => {
  const cm = (id: string, status: ClassMaster['status']): ClassMaster => ({
    id,
    displayName: id,
    type: 'Private',
    level: 'N5',
    senseiId: 's1',
    studentIds: ['st1'],
    requiredMeetings: 10,
    sessionDurationMinutes: 90,
    status
  });
  const enr = (id: string, classId: string, extra: Partial<Enrollment> = {}): Enrollment => ({
    ...enrollment,
    id,
    classId,
    ...extra
  });
  const classes = [cm('old', 'completed'), cm('live', 'active'), cm('draft', 'draft')];

  it('flags an active enrollment whose class is completed or cancelled as stale', () => {
    expect(isEnrollmentStale(enr('e1', 'old'), classes)).toBe(true);
    expect(isEnrollmentStale(enr('e2', 'live'), classes)).toBe(false);
    expect(isEnrollmentStale(enr('e3', 'missing'), classes)).toBe(false);
    expect(isEnrollmentStale(enr('e4', ''), classes)).toBe(false);
  });

  it('prefers a running class over a stale one, whatever the array order', () => {
    const list = [
      enr('stale', 'old', { startDate: '2026-09-01' }),
      enr('live', 'live', { startDate: '2026-07-01' })
    ];
    expect(pickCurrentEnrollment(list, classes)?.id).toBe('live');
  });

  it('takes the most recently started among equals and ignores closed enrollments', () => {
    const list = [
      enr('older', 'live', { startDate: '2026-07-01' }),
      enr('newer', 'live', { startDate: '2026-10-01' }),
      enr('done', 'live', { startDate: '2026-12-01', status: 'completed' })
    ];
    expect(pickCurrentEnrollment(list, classes)?.id).toBe('newer');
  });

  it('falls back to a stale enrollment when nothing else is active', () => {
    expect(pickCurrentEnrollment([enr('stale', 'old')], classes)?.id).toBe('stale');
    expect(pickCurrentEnrollment([], classes)).toBeUndefined();
  });
});

describe('deriveEnrollmentDisplayStatus: planned end without progress', () => {
  const now = new Date('2026-10-28T10:00:00');
  const soon = { ...enrollment, plannedEndDate: '2026-11-03', requiredMeetings: 10, sessionsCompleted: 0 };

  it('does not say "mau habis" when no session was delivered yet', () => {
    expect(deriveEnrollmentDisplayStatus(soon, [], [], now)).toBe('active');
  });

  it('still says "mau habis" when sessions were delivered and the planned end is near', () => {
    expect(deriveEnrollmentDisplayStatus({ ...soon, sessionsCompleted: 4 }, [], [], now)).toBe('ending_soon');
  });

  it('still says "mau habis" when 2 or fewer sessions remain', () => {
    expect(
      deriveEnrollmentDisplayStatus({ ...soon, plannedEndDate: null, sessionsCompleted: 8 }, [], [], now)
    ).toBe('ending_soon');
  });
});

describe('ensureClassEnrollments: class target changes', () => {
  const teachingClass: ClassMaster = {
    id: 'c1',
    displayName: 'Private N5',
    type: 'Private',
    level: 'Guntai 3',
    senseiId: 's1',
    studentIds: ['st1', 'st2'],
    requiredMeetings: 2,
    sessionDurationMinutes: 90,
    startDate: '2026-09-01',
    status: 'ready'
  };
  const make = (studentId: string, requiredMeetings: number | null): Enrollment => ({
    ...enrollment,
    id: `e-${studentId}`,
    studentId,
    classId: 'c1',
    requiredMeetings
  });

  it('moves enrollments that copied the old class target to the new one', () => {
    const result = ensureClassEnrollments({
      enrollments: [make('st1', 10), make('st2', 10)],
      teachingClass,
      createId: () => 'new',
      previousRequiredMeetings: 10
    });
    expect(result.enrollments.map((item) => item.requiredMeetings)).toEqual([2, 2]);
    expect(result.changed).toHaveLength(2);
  });

  it('keeps a target that was set on purpose (differs from the old class target)', () => {
    const result = ensureClassEnrollments({
      enrollments: [make('st1', 39), make('st2', 50)],
      teachingClass: { ...teachingClass, requiredMeetings: 60 },
      createId: () => 'new',
      previousRequiredMeetings: 50
    });
    expect(result.enrollments.map((item) => item.requiredMeetings)).toEqual([39, 60]);
  });

  it('fills an empty target and leaves everything alone when no previous target is known', () => {
    const empty = ensureClassEnrollments({
      enrollments: [make('st1', null), make('st2', 10)],
      teachingClass,
      createId: () => 'new'
    });
    expect(empty.enrollments.map((item) => item.requiredMeetings)).toEqual([2, 10]);
  });
});
