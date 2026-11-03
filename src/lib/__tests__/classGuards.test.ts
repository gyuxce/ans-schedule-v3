import { describe, expect, it } from 'vitest';
import { findOverlappingClasses, planClassReactivation } from '../classSync';
import { CLASS_CANCELLED_REASON, classifyRemoteError } from '../remoteError';
import type { ClassMaster, ClassSession, SessionReport } from '../../types';

const klass = (overrides: Partial<ClassMaster>): ClassMaster => ({
  id: 'c1',
  displayName: 'Group N5',
  type: 'Group',
  level: 'N5',
  senseiId: 's1',
  studentIds: ['a', 'b'],
  requiredMeetings: 20,
  sessionDurationMinutes: 90,
  startDate: '2026-11-04',
  status: 'active',
  ...overrides
});

const session = (overrides: Partial<ClassSession>): ClassSession => ({
  id: 'x',
  classId: 'c1',
  senseiId: 's1',
  studentIds: ['a', 'b'],
  type: 'Group',
  level: 'N5',
  date: '2026-11-11',
  startTime: '20:30',
  endTime: '22:00',
  status: 'active',
  ...overrides
});

const cascaded = (overrides: Partial<ClassSession>) =>
  session({
    status: 'cancelled',
    cancellationReason: CLASS_CANCELLED_REASON,
    cancellationInitiator: 'Admin',
    replacementSecured: false,
    ...overrides
  });

describe('classifyRemoteError', () => {
  it('reads a row-level security refusal as a not-saved warning', () => {
    const message = 'new row violates row-level security policy for table "class_masters"';
    expect(classifyRemoteError(message, true)).toMatchObject({ kind: 'permission' });
    expect(classifyRemoteError(message, true).text).toContain('BELUM tersimpan');
  });

  it('reads the same refusal without a login session as an expired session', () => {
    expect(classifyRemoteError('new row violates row-level security policy', false).kind).toBe('session');
    expect(classifyRemoteError('JWT expired', true).kind).toBe('session');
  });

  it('leaves other errors as they are', () => {
    expect(classifyRemoteError('duplicate key value', true)).toEqual({
      kind: 'other',
      text: 'duplicate key value'
    });
  });
});

describe('findOverlappingClasses', () => {
  const existing = [klass({ id: 'old' })];

  it('finds a live class of the same level that shares a student', () => {
    const found = findOverlappingClasses(existing, { id: 'new', level: 'N5', studentIds: ['b', 'z'] });
    expect(found.map((item) => item.id)).toEqual(['old']);
  });

  it('ignores another level, no shared student, itself and ended classes', () => {
    expect(findOverlappingClasses(existing, { id: 'new', level: 'N4', studentIds: ['a'] })).toHaveLength(0);
    expect(findOverlappingClasses(existing, { id: 'new', level: 'N5', studentIds: ['z'] })).toHaveLength(0);
    expect(findOverlappingClasses(existing, { id: 'old', level: 'N5', studentIds: ['a'] })).toHaveLength(0);
    const ended = [klass({ id: 'old', status: 'cancelled' }), klass({ id: 'done', status: 'completed' })];
    expect(findOverlappingClasses(ended, { id: 'new', level: 'N5', studentIds: ['a'] })).toHaveLength(0);
  });
});

describe('planClassReactivation', () => {
  const today = '2026-11-10';
  const plan = (schedules: ClassSession[], reports: SessionReport[] = []) =>
    planClassReactivation({ schedules, reports, classId: 'c1', today });

  it('brings back upcoming sessions that were cancelled with the class', () => {
    const { restored, blocked } = plan([
      cascaded({ id: 'u1', date: '2026-11-11' }),
      cascaded({ id: 'u2', date: '2026-11-14' })
    ]);
    expect(blocked).toHaveLength(0);
    expect(restored.map((item) => item.id)).toEqual(['u1', 'u2']);
    expect(restored[0]).toMatchObject({
      status: 'active',
      cancellationReason: null,
      cancellationInitiator: null,
      replacementSecured: null
    });
  });

  it('keeps sessions cancelled for another reason, in the past, reported or of another class', () => {
    const { restored } = plan(
      [
        cascaded({ id: 'by-hand', cancellationReason: 'Siswa sakit' }),
        cascaded({ id: 'past', date: '2026-11-04' }),
        cascaded({ id: 'reported', date: '2026-11-12' }),
        cascaded({ id: 'other', classId: 'c2', date: '2026-11-13' })
      ],
      [{ scheduleId: 'reported' } as SessionReport]
    );
    expect(restored).toHaveLength(0);
  });

  it('leaves a session cancelled when the Sensei is busy then', () => {
    const { restored, blocked } = plan([
      cascaded({ id: 'u1', date: '2026-11-11' }),
      cascaded({ id: 'u2', date: '2026-11-14' }),
      session({ id: 'busy', classId: 'c9', studentIds: ['q'], date: '2026-11-14', startTime: '21:00' })
    ]);
    expect(restored.map((item) => item.id)).toEqual(['u1']);
    expect(blocked.map((item) => item.id)).toEqual(['u2']);
  });
});
