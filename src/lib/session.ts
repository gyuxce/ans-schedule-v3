import type { ClassSession, SessionLog, SessionReport, SessionWorkflowState } from '../types';
import { classStartUtc } from './timezone';

export function getSessionWorkflow(
  session: ClassSession,
  log?: SessionLog,
  report?: SessionReport
): SessionWorkflowState {
  if (session.status === 'cancelled') return 'cancelled';
  if (report) return 'completed';
  if (log?.clockOutAt) return 'report_pending';
  if (log?.clockInAt) return 'in_progress';
  return 'ready';
}

export function workflowLabel(state: SessionWorkflowState) {
  return {
    ready: 'Belum mulai',
    in_progress: 'Sedang berjalan',
    report_pending: 'Laporan belum diisi',
    completed: 'Selesai',
    cancelled: 'Dibatalkan'
  }[state];
}

/**
 * Late-join compares clock-in (absolute) against class start — always
 * anchored to WIB, the timezone Admin schedules in, regardless of which
 * zone the teaching Sensei is actually in — then applies grace minutes.
 */
export function isLateJoin(session: ClassSession, clockInAt: string, graceMinutes: number) {
  const scheduled = classStartUtc(session.date, session.startTime);
  const actual = new Date(clockInAt);
  const diff = (actual.getTime() - scheduled.getTime()) / 60000;
  return diff > graceMinutes;
}

export function expectedStudentCount(session: ClassSession) {
  return Math.max(1, session.studentIds.length);
}
