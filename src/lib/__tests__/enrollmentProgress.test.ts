import { describe, expect, it } from 'vitest';
import { countEnrollmentSessionsCompleted } from '../enrollment';
import type { ClassSession, Enrollment, SessionReport } from '../../types';

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
