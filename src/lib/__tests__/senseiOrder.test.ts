import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() })
}));
vi.mock('../supabase', async (orig) => ({
  ...(await orig<object>()),
  isSupabaseConfigured: () => false,
  getSupabase: () => null
}));

import { compareSenseiByJoinDate, sortSenseiActiveFirst, sortSenseiByJoinDate } from '../senseiOrder';
import { useDashboardStore } from '../../store/useDashboardStore';
import type { Sensei } from '../../types';

const s = (name: string, joinDate: string, primaryStatus: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') =>
  ({ id: name, name, joinDate, primaryStatus, levels: [], timezone: 'Asia/Jakarta' }) as unknown as Sensei;

describe('Sensei order: newest join first, then A-Z', () => {
  it('orders by join date descending', () => {
    const sorted = sortSenseiByJoinDate([s('A', '2026-08-18'), s('B', '2026-10-24'), s('C', '2025-12-30')]);
    expect(sorted.map((x) => x.name)).toEqual(['B', 'A', 'C']);
  });
  it('same join date is A-Z, ignoring case', () => {
    const sorted = sortSenseiByJoinDate([
      s('budi', '2026-10-24'),
      s('Citra', '2026-10-24'),
      s('Andi', '2026-10-24')
    ]);
    expect(sorted.map((x) => x.name)).toEqual(['Andi', 'budi', 'Citra']);
  });
  it('a Sensei without a join date goes last and the input is not mutated', () => {
    const input = [s('A', ''), s('B', '2026-01-01')];
    expect(sortSenseiByJoinDate(input).map((x) => x.name)).toEqual(['B', 'A']);
    expect(input.map((x) => x.name)).toEqual(['A', 'B']);
  });
  it('inactive Sensei come after active ones, each group in the same order', () => {
    const sorted = sortSenseiActiveFirst([
      s('Old', '2025-01-01', 'INACTIVE'),
      s('Lama', '2025-06-01'),
      s('Baru', '2026-10-01'),
      s('New', '2026-11-01', 'INACTIVE')
    ]);
    expect(sorted.map((x) => x.name)).toEqual(['Baru', 'Lama', 'New', 'Old']);
  });
  it('can compare on a different display name', () => {
    const a = { name: 'Zed', joinDate: '2026-01-01' };
    const b = { name: 'Amy', joinDate: '2026-01-01' };
    expect(compareSenseiByJoinDate(a, b, () => 'x')).toBe(0);
  });
});

describe('saving a Sensei keeps the list in order', () => {
  beforeEach(() => {
    useDashboardStore.setState({
      currentUser: { id: 'u', name: 'admin', email: 'a@a', role: 'Super Admin', status: 'Approved' } as never,
      sensei: [s('B', '2026-10-24'), s('A', '2026-08-18')]
    });
  });
  it('a new Sensei lands at its place, not at the top', () => {
    useDashboardStore
      .getState()
      .upsertSensei({ ...s('Mid', '2026-09-01'), id: undefined, email: 'm@a.id' } as never);
    expect(useDashboardStore.getState().sensei.map((x) => x.name)).toEqual(['B', 'Mid', 'A']);
  });
  it('editing a join date moves the Sensei', () => {
    useDashboardStore.getState().upsertSensei({ ...s('A', '2026-11-05'), email: 'a@a.id' } as never);
    expect(useDashboardStore.getState().sensei.map((x) => x.name)).toEqual(['A', 'B']);
  });
});
