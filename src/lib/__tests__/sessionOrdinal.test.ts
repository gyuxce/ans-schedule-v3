import { describe, expect, it } from 'vitest';
import { getSessionOrdinal } from '../classProgress';
import type { ClassMaster, ClassSession, SessionReport } from '../../types';

const teachingClass: ClassMaster = {
  id: 'c1',
  displayName: 'Private N4',
  type: 'Private',
  level: 'N4',
  senseiId: 's1',
  studentIds: ['st1'],
  requiredMeetings: 30,
  sessionDurationMinutes: 90,
  startDate: '2026-10-12',
  plannedEndDate: '2027-01-04',
  status: 'active'
};

const session = (id: string, date: string, extra: Partial<ClassSession> = {}): ClassSession => ({
  id,
  classId: 'c1',
  senseiId: 's1',
  studentIds: ['st1'],
  type: 'Private',
  level: 'N4',
  date,
  startTime: '15:00',
  endTime: '16:30',
  status: 'active',
  ...extra
});
const report = (scheduleId: string) => ({ scheduleId }) as SessionReport;
const today = '2026-10-20';

describe('getSessionOrdinal', () => {
  it('keeps the plain label when every earlier past session was reported', () => {
    const schedules = [
      session('a', '2026-10-02', { status: 'completed' }),
      session('b', '2026-10-05'),
      session('c', '2026-10-16')
    ];
    const ordinal = getSessionOrdinal(schedules[2], schedules, teachingClass, [report('b')], today);
    expect(ordinal).toMatchObject({ index: 3, completed: 2, unreportedBefore: 0, label: 'Sesi 3 dari 30' });
  });

  it('says how many are done when older past sessions were never reported', () => {
    const stale = ['2026-08-05', '2026-08-12', '2026-08-19'].map((date, i) => session(`old${i}`, date));
    const done = [session('d1', '2026-10-02', { status: 'completed' }), session('d2', '2026-10-05')];
    const target = session('t', '2026-10-16');
    const schedules = [...stale, ...done, target];
    const ordinal = getSessionOrdinal(target, schedules, teachingClass, [report('d2')], today);
    expect(ordinal).toMatchObject({ index: 6, completed: 2, unreportedBefore: 3 });
    expect(ordinal?.label).toBe('Sesi 6 dari 30 · 2 selesai');
  });

  it('does not treat earlier future sessions as unreported', () => {
    const schedules = [session('a', '2026-10-27'), session('b', '2026-11-03')];
    const ordinal = getSessionOrdinal(schedules[1], schedules, teachingClass, [], today);
    expect(ordinal).toMatchObject({ index: 2, unreportedBefore: 0, label: 'Sesi 2 dari 30' });
  });

  it('labels Extra meetings as before', () => {
    const extra = session('x', '2026-10-21', { isExtra: true });
    expect(getSessionOrdinal(extra, [extra], teachingClass, [], today)?.label).toBe('Extra');
  });
});
