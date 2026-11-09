import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
    warning: vi.fn()
  })
}));
vi.mock('../supabase', async (orig) => ({
  ...(await orig<object>()),
  isSupabaseConfigured: () => false,
  getSupabase: () => null
}));

import { duplicateClassError } from '../classSync';
import { useDashboardStore } from '../../store/useDashboardStore';
import type { ClassMaster, ClassType } from '../../types';

const sensei = (id: string) => ({
  id,
  name: id,
  displayName: id,
  primaryStatus: 'ACTIVE',
  levels: [],
  timezone: 'Asia/Jakarta'
});
const student = (id: string) => ({ id, name: id, level: 'Pra Guntai', type: 'Private', isActive: true });

const base = {
  displayName: 'Kelas',
  senseiId: 'S1',
  requiredMeetings: 7,
  sessionDurationMinutes: 90,
  startDate: '2099-11-11'
};

function reset() {
  toastError.mockClear();
  useDashboardStore.setState({
    currentUser: { id: 'u', name: 'admin', email: 'a@a', role: 'Super Admin', status: 'Approved' } as never,
    classMasters: [],
    schedules: [],
    sessionReports: [],
    enrollments: [],
    sensei: [sensei('S1'), sensei('S2')] as never,
    students: ['a', 'b', 'c'].map(student) as never
  });
}

const recurring = (type: ClassType, studentIds: string[], level = 'Pra Guntai') =>
  useDashboardStore.getState().createRecurringOfficialClass({
    displayName: `Baru ${type}`,
    senseiId: 'S1',
    studentIds,
    type,
    level,
    startDate: '2099-11-11',
    weekdays: [3, 4],
    startTime: '19:00',
    durationMinutes: 90,
    requiredMeetings: 4
  });

const classMaster = (type: ClassType, studentIds: string[], level = 'Pra Guntai') =>
  useDashboardStore.getState().upsertClassMaster({
    ...base,
    type,
    level,
    studentIds,
    status: 'ready'
  } as never);

describe('new class flows', () => {
  beforeEach(reset);

  it.each([
    ['Private', ['a']],
    ['Semi-Private', ['a', 'b']],
    ['Group', ['a', 'b', 'c']]
  ] as [ClassType, string[]][])(
    '%s: Jadwal Resmi creates class, sessions and enrollments in one go',
    (type, ids) => {
      expect(recurring(type, ids)).toBe(true);
      const state = useDashboardStore.getState();
      expect(state.classMasters).toHaveLength(1);
      expect(state.schedules).toHaveLength(4);
      expect(state.enrollments).toHaveLength(ids.length);
      expect(state.enrollments.every((item) => item.classId === state.classMasters[0]?.id)).toBe(true);
    }
  );

  it('Class Master first, then Generate, works without a clash', () => {
    const id = classMaster('Private', ['a']);
    expect(id).toBeTruthy();
    const made = useDashboardStore.getState().generateClassSchedule({
      classId: id!,
      startDate: '2099-11-11',
      weekdays: [3, 4],
      startTime: '19:00',
      meetings: 4
    });
    expect(made).toBe(4);
  });

  it('entering the same class twice (Jadwal Resmi, then Class Master) is refused with a clear reason', () => {
    expect(recurring('Private', ['a'])).toBe(true);
    expect(classMaster('Private', ['a'])).toBeNull();
    expect(useDashboardStore.getState().classMasters).toHaveLength(1);
    expect(String(toastError.mock.calls[0]?.[0])).toContain('Generate jadwal');
  });

  it('the same in the other order (Class Master, then Jadwal Resmi) is refused too', () => {
    expect(classMaster('Semi-Private', ['a', 'b'])).toBeTruthy();
    expect(recurring('Semi-Private', ['a', 'b'])).toBe(false);
    expect(useDashboardStore.getState().classMasters).toHaveLength(1);
  });

  it('a different type, level or student set is still allowed', () => {
    expect(recurring('Private', ['a'])).toBe(true);
    expect(classMaster('Group', ['a', 'b', 'c'])).toBeTruthy();
    expect(classMaster('Private', ['a'], 'N5')).toBeTruthy();
    expect(classMaster('Private', ['b'])).toBeTruthy();
  });

  it('a replacement is allowed once the old class is cancelled or completed', () => {
    const first = classMaster('Private', ['a'])!;
    expect(classMaster('Private', ['a'])).toBeNull();
    const existing = useDashboardStore.getState().classMasters.find((item) => item.id === first)!;
    useDashboardStore.getState().upsertClassMaster({ ...existing, status: 'completed' } as never);
    expect(classMaster('Private', ['a'])).toBeTruthy();
  });

  it('Generate from a second class explains the clash with the class that already owns the dates', () => {
    expect(recurring('Private', ['a'])).toBe(true);
    const state = useDashboardStore.getState();
    // a class that slipped in before the guard existed (data already in the database)
    const dup: ClassMaster = {
      ...base,
      id: 'dup',
      displayName: 'Duplikat',
      type: 'Private',
      level: 'Pra Guntai',
      studentIds: ['a'],
      status: 'active'
    };
    useDashboardStore.setState({ classMasters: [dup, ...state.classMasters] });
    toastError.mockClear();
    const made = useDashboardStore.getState().generateClassSchedule({
      classId: 'dup',
      startDate: '2099-11-11',
      weekdays: [3, 4],
      startTime: '19:00',
      meetings: 4
    });
    expect(made).toBe(0);
    expect(String(toastError.mock.calls[0]?.[0])).toContain('sudah dibuat oleh kelas "Baru Private"');
  });
});

describe('duplicateClassError', () => {
  const live = (type: ClassType): ClassMaster => ({
    ...base,
    id: 'x',
    displayName: 'Lama',
    type,
    level: 'N5',
    studentIds: ['a'],
    status: 'active'
  });

  it('only fires for the same type and level with a shared student', () => {
    expect(
      duplicateClassError([live('Private')], { level: 'N5', type: 'Private', studentIds: ['a'] })
    ).toContain('Lama');
    expect(
      duplicateClassError([live('Private')], { level: 'N5', type: 'Group', studentIds: ['a'] })
    ).toBeNull();
    expect(
      duplicateClassError([live('Private')], { level: 'N4', type: 'Private', studentIds: ['a'] })
    ).toBeNull();
    expect(
      duplicateClassError([live('Private')], { level: 'N5', type: 'Private', studentIds: ['z'] })
    ).toBeNull();
  });
});
