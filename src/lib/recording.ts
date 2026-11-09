import type { ClassSession, RecordingStatus, SessionReport } from '../types';

/**
 * A Sensei who pasted a recording link but left the status on "Missing" has
 * obviously delivered the recording: Kyouiku should be able to review it
 * without chasing the Sensei to change the status.
 */
export function normalizeRecordingStatus(
  recordingUrl: string | null | undefined,
  status: RecordingStatus
): RecordingStatus {
  return status === 'Missing' && (recordingUrl ?? '').trim() ? 'Available' : status;
}

export interface RecordingFilters {
  senseiId: string;
  studentId: string;
  level: string;
  from: string;
  to: string;
  status: RecordingStatus | 'all';
}

export const EMPTY_RECORDING_FILTERS: RecordingFilters = {
  senseiId: 'all',
  studentId: 'all',
  level: 'all',
  from: '',
  to: '',
  status: 'all'
};

export function isRecordingFilterActive(filters: RecordingFilters) {
  return (Object.keys(EMPTY_RECORDING_FILTERS) as Array<keyof RecordingFilters>).some(
    (key) => filters[key] !== EMPTY_RECORDING_FILTERS[key]
  );
}

export function matchesRecordingFilters(
  report: SessionReport,
  session: ClassSession,
  filters: RecordingFilters
) {
  if (filters.senseiId !== 'all' && session.senseiId !== filters.senseiId) return false;
  if (filters.studentId !== 'all' && !session.studentIds.includes(filters.studentId)) return false;
  if (filters.level !== 'all' && session.level !== filters.level) return false;
  if (filters.from && session.date < filters.from) return false;
  if (filters.to && session.date > filters.to) return false;
  if (filters.status !== 'all' && report.recordingStatus !== filters.status) return false;
  return true;
}
