import { describe, expect, it } from 'vitest';
import { planClassTakeOver, syncUpcomingSessionStudents } from '../classSync';
import type { ClassSession, SessionReport } from '../../types';

function session(overrides: Partial<ClassSession>): ClassSession {
  return {
    id: 'x',
    classId: 'c1',
    senseiId: 's1',
    studentIds: ['a', 'b'],
    type: 'Semi-Private',
    level: 'Pra Guntai',
    date: '2026-10-21',
    startTime: '19:00',
    endTime: '20:30',
    status: 'active',
    ...overrides
  };
}

const report = (scheduleId: string) => ({ scheduleId }) as SessionReport;

describe('syncUpcomingSessionStudents', () => {
  const schedules = [
    session({ id: 'past', date: '2026-10-07' }),
    session({ id: 'done', date: '2026-10-14', status: 'completed' }),
    session({ id: 'reported', date: '2026-10-14' }),
    session({ id: 'cancelled', date: '2026-10-21', status: 'cancelled' }),
    session({ id: 'next', date: '2026-10-21' }),
    session({ id: 'later', date: '2026-10-28' }),
    session({ id: 'other-class', classId: 'c2', date: '2026-10-28' }),
    session({ id: 'already', date: '2026-11-04', studentIds: ['c', 'a', 'b'] })
  ];

  it('adds the new student to upcoming sessions only', () => {
    const changed = syncUpcomingSessionStudents({
      schedules,
      reports: [report('reported')],
      classId: 'c1',
      studentIds: ['a', 'b', 'c'],
      today: '2026-10-15'
    });
    expect(changed.map((item) => item.id).sort()).toEqual(['later', 'next']);
    expect(changed.every((item) => item.studentIds.join() === 'a,b,c')).toBe(true);
  });

  it('drops a removed student from upcoming sessions too', () => {
    const changed = syncUpcomingSessionStudents({
      schedules,
      reports: [],
      classId: 'c1',
      studentIds: ['a'],
      today: '2026-10-15'
    });
    expect(changed.map((item) => item.id)).toContain('next');
    expect(changed.find((item) => item.id === 'already')?.studentIds).toEqual(['a']);
  });
});

describe('planClassTakeOver', () => {
  const base = {
    reports: [] as SessionReport[],
    classId: 'c1',
    newSenseiId: 's2',
    effectiveDate: '2026-10-15',
    reason: 'Sensei resign'
  };

  it('moves only open sessions from the effective date and keeps the original Sensei', () => {
    const schedules = [
      session({ id: 'past', date: '2026-10-07' }),
      session({ id: 'done', date: '2026-10-14', status: 'completed' }),
      session({ id: 'next', date: '2026-10-21' }),
      session({ id: 'swapped', date: '2026-10-28', senseiId: 's3', originalSenseiId: 's1' })
    ];
    const { moved, conflicts } = planClassTakeOver({ ...base, schedules });
    expect(moved.map((item) => item.id)).toEqual(['next', 'swapped']);
    expect(conflicts).toEqual([]);
    expect(moved[0]).toMatchObject({
      senseiId: 's2',
      originalSenseiId: 's1',
      swapReason: 'Take over: Sensei resign'
    });
    expect(moved[1]?.originalSenseiId).toBe('s1');
  });

  it('flags sessions that collide with the new Sensei existing class', () => {
    const schedules = [
      session({ id: 'next', date: '2026-10-21' }),
      session({ id: 'busy', classId: 'c9', senseiId: 's2', date: '2026-10-21', startTime: '19:30' })
    ];
    const { conflicts } = planClassTakeOver({ ...base, schedules });
    expect(conflicts.map((item) => item.id)).toEqual(['next']);
  });
});
