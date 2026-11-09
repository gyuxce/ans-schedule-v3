import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() })
}));
vi.mock('../supabase', async (orig) => ({
  ...(await orig<object>()),
  isSupabaseConfigured: () => false,
  getSupabase: () => null
}));

import { getDisciplinaryMetrics, monthKey } from '../disciplinary';
import { toExternalHref } from '../externalLink';
import {
  EMPTY_RECORDING_FILTERS,
  isRecordingFilterActive,
  matchesRecordingFilters,
  normalizeRecordingStatus
} from '../recording';
import { useDashboardStore } from '../../store/useDashboardStore';
import type { ClassSession, SessionLog, SessionReport } from '../../types';

const session = (patch: Partial<ClassSession>): ClassSession =>
  ({
    id: 's1',
    senseiId: 'S1',
    studentIds: ['a'],
    type: 'Private',
    level: 'N5',
    date: '2026-11-05',
    startTime: '19:00',
    endTime: '20:00',
    status: 'completed',
    ...patch
  }) as ClassSession;
const report = (patch: Partial<SessionReport>): SessionReport =>
  ({ id: 'r1', scheduleId: 's1', recordingStatus: 'Available', ...patch }) as SessionReport;

describe('class links are clickable only when they are real links', () => {
  it('accepts http(s) and bare domains', () => {
    expect(toExternalHref('https://classroom.google.com/c/abc')).toBe('https://classroom.google.com/c/abc');
    expect(toExternalHref(' drive.google.com/file/d/1/view ')).toBe('https://drive.google.com/file/d/1/view');
    expect(toExternalHref('localhost:3000/x')).toBeNull();
  });
  it('refuses plain text and script schemes', () => {
    expect(toExternalHref('')).toBeNull();
    expect(toExternalHref('lihat di grup WA')).toBeNull();
    expect(toExternalHref('javascript:alert(1)')).toBeNull();
    expect(toExternalHref('mailto:a@b.com')).toBeNull();
    expect(toExternalHref('data:text/html,hi')).toBeNull();
  });
});

describe('recording status follows the link', () => {
  it('Missing + link becomes Available, nothing else changes', () => {
    expect(normalizeRecordingStatus('https://x.y/z', 'Missing')).toBe('Available');
    expect(normalizeRecordingStatus('  ', 'Missing')).toBe('Missing');
    expect(normalizeRecordingStatus(undefined, 'Missing')).toBe('Missing');
    expect(normalizeRecordingStatus('https://x.y/z', 'Not Required')).toBe('Not Required');
  });

  beforeEach(() => {
    useDashboardStore.setState({
      currentUser: { id: 'u', name: 'sensei', email: 'a@a', role: 'Sensei', status: 'Approved' } as never,
      schedules: [session({ status: 'active' })],
      sessionReports: []
    });
  });
  it('saving a report with a link and status Missing stores Available', () => {
    useDashboardStore.getState().submitSessionReport('s1', {
      students: [],
      materialCovered: 'bab 1',
      levelProgress: '',
      recordingUrl: 'https://drive.google.com/file/d/1/view',
      recordingStatus: 'Missing'
    });
    expect(useDashboardStore.getState().sessionReports[0].recordingStatus).toBe('Available');
  });
  it('saving without a link keeps Missing', () => {
    useDashboardStore.getState().submitSessionReport('s1', {
      students: [],
      materialCovered: 'bab 1',
      levelProgress: '',
      recordingStatus: 'Missing'
    });
    expect(useDashboardStore.getState().sessionReports[0].recordingStatus).toBe('Missing');
  });
});

describe('recording filters', () => {
  const s = session({});
  it('empty filters match everything and are inactive', () => {
    expect(matchesRecordingFilters(report({}), s, EMPTY_RECORDING_FILTERS)).toBe(true);
    expect(isRecordingFilterActive(EMPTY_RECORDING_FILTERS)).toBe(false);
  });
  it('filters by sensei, student, level, status and inclusive dates', () => {
    const f = EMPTY_RECORDING_FILTERS;
    expect(matchesRecordingFilters(report({}), s, { ...f, senseiId: 'S2' })).toBe(false);
    expect(matchesRecordingFilters(report({}), s, { ...f, senseiId: 'S1' })).toBe(true);
    expect(matchesRecordingFilters(report({}), s, { ...f, studentId: 'b' })).toBe(false);
    expect(matchesRecordingFilters(report({}), s, { ...f, studentId: 'a' })).toBe(true);
    expect(matchesRecordingFilters(report({}), s, { ...f, level: 'N4' })).toBe(false);
    expect(matchesRecordingFilters(report({}), s, { ...f, status: 'Missing' })).toBe(false);
    expect(
      matchesRecordingFilters(report({ recordingStatus: 'Missing' }), s, { ...f, status: 'Missing' })
    ).toBe(true);
    expect(matchesRecordingFilters(report({}), s, { ...f, from: '2026-11-05', to: '2026-11-05' })).toBe(true);
    expect(matchesRecordingFilters(report({}), s, { ...f, from: '2026-11-06' })).toBe(false);
    expect(matchesRecordingFilters(report({}), s, { ...f, to: '2026-11-04' })).toBe(false);
    expect(isRecordingFilterActive({ ...f, level: 'N5' })).toBe(true);
  });
});

describe('disciplinary period', () => {
  const swap = (id: string, date: string) =>
    session({ id, date, senseiId: 'S1', originalSenseiId: 'S1', swapInitiator: 'Sensei' });
  const schedules = [swap('o1', '2026-10-29'), swap('n1', '2026-11-02'), swap('n2', '2026-11-20')];
  const logs = [
    { id: 'l1', scheduleId: 'o1', senseiId: 'S1', lateJoin: true },
    { id: 'l2', scheduleId: 'n2', senseiId: 'S1', lateJoin: true }
  ] as SessionLog[];

  it('a month keeps working as before, so October can be compared with November', () => {
    expect(getDisciplinaryMetrics('S1', '2026-10', schedules, logs)).toMatchObject({
      senseiInitiatedSwaps: 1,
      lateJoins: 1
    });
    expect(getDisciplinaryMetrics('S1', '2026-11', schedules, logs)).toMatchObject({
      senseiInitiatedSwaps: 2,
      lateJoins: 1
    });
  });
  it('a weekly range counts only that range, both ends inclusive', () => {
    const week = { from: '2026-11-02', to: '2026-11-08' };
    expect(getDisciplinaryMetrics('S1', week, schedules, logs)).toMatchObject({
      senseiInitiatedSwaps: 1,
      lateJoins: 0
    });
    expect(
      getDisciplinaryMetrics('S1', { from: '2026-10-29', to: '2026-11-02' }, schedules, logs)
    ).toMatchObject({
      senseiInitiatedSwaps: 2
    });
    expect(getDisciplinaryMetrics('S1', { from: '2026-11-03' }, schedules, logs).senseiInitiatedSwaps).toBe(
      1
    );
  });
  it('monthKey uses the local calendar day, not UTC', () => {
    expect(monthKey(new Date(2026, 10, 1, 0, 30))).toBe('2026-11');
    expect(monthKey('2026-10-31')).toBe('2026-10');
  });
});
