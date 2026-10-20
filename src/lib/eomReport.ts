import { format, parseISO } from 'date-fns';
import { getSessionOrdinal } from './classProgress';
import { actualDurationMinutes, scheduledDurationMinutes } from './duration';
import { displayName } from './display';
import type { ClassMaster, ClassSession, Sensei, SessionLog, SessionReport, Student } from '../types';

export type EomSessionRow = {
  senseiId: string;
  senseiName: string;
  className: string;
  level: string;
  classType: string;
  students: string;
  date: string;
  startTime: string;
  endTime: string;
  clockIn: string;
  clockOut: string;
  scheduledMinutes: number;
  actualMinutes: number | null;
  sessionLabel: string;
  status: string;
  lateJoin: string;
  lateMinutes: string;
  swap: string;
  cancellation: string;
  sessionKind: string;
};

export type EomSenseiSummary = {
  senseiId: string;
  senseiName: string;
  completedSessions: number;
  scheduledHours: number;
  actualHours: number;
  lateJoins: number;
  senseiInitiatedSwaps: number;
  senseiRelatedCancellations: number;
};

function lateMinutes(session: ClassSession, log: SessionLog | undefined) {
  if (!log?.clockInAt || !log.lateJoin) return null;
  const scheduled = parseISO(`${session.date}T${session.startTime}:00`);
  const clock = parseISO(log.clockInAt);
  const mins = Math.round((clock.getTime() - scheduled.getTime()) / 60000);
  return mins > 0 ? mins : 0;
}

export function buildEomSessionRows(input: {
  month: string;
  senseiId: string | 'all';
  status: ClassSession['status'] | 'all';
  schedules: ClassSession[];
  sessionLogs: SessionLog[];
  sessionReports: SessionReport[];
  classMasters: ClassMaster[];
  sensei: Sensei[];
  students: Student[];
}): EomSessionRow[] {
  const { month, senseiId, status } = input;
  const rows = input.schedules
    .filter((session) => session.date.startsWith(month))
    .filter((session) => (senseiId === 'all' ? true : session.senseiId === senseiId))
    .filter((session) => (status === 'all' ? true : session.status === status))
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));

  return rows.map((session) => {
    const log = input.sessionLogs.find((item) => item.scheduleId === session.id);
    const teachingClass = session.classId
      ? input.classMasters.find((item) => item.id === session.classId)
      : undefined;
    const ordinal = getSessionOrdinal(session, input.schedules, teachingClass, input.sessionReports);
    const late = lateMinutes(session, log);
    const studentNames = session.studentIds
      .map((id) => input.students.find((s) => s.id === id)?.name ?? id)
      .join(', ');
    let sessionKind = 'Regular';
    if (session.isExtra) sessionKind = 'Extra';
    else if (session.makeupOfSessionId) sessionKind = 'Replacement / Makeup';

    return {
      senseiId: session.senseiId,
      senseiName: displayName(input.sensei, session.senseiId),
      className: teachingClass?.displayName || session.level,
      level: session.level,
      classType: session.type,
      students: studentNames,
      date: session.date,
      startTime: session.startTime,
      endTime: session.endTime,
      clockIn: log?.clockInAt ? format(parseISO(log.clockInAt), 'yyyy-MM-dd HH:mm') : '',
      clockOut: log?.clockOutAt ? format(parseISO(log.clockOutAt), 'yyyy-MM-dd HH:mm') : '',
      scheduledMinutes: scheduledDurationMinutes(session),
      actualMinutes: actualDurationMinutes(log),
      sessionLabel: ordinal?.label ?? '—',
      status: session.status,
      lateJoin: log?.lateJoin ? 'Yes' : 'No',
      lateMinutes: late == null ? '' : String(late),
      swap: session.originalSenseiId
        ? `Swapped (${session.swapInitiator || '—'}) ${session.swapReason || ''}`.trim()
        : '',
      cancellation:
        session.status === 'cancelled'
          ? `${session.cancellationInitiator || '—'}: ${session.cancellationReason || ''}`.trim()
          : '',
      sessionKind
    };
  });
}

export function summarizeEomBySensei(rows: EomSessionRow[]): EomSenseiSummary[] {
  const map = new Map<string, EomSenseiSummary>();
  for (const row of rows) {
    const current = map.get(row.senseiId) ?? {
      senseiId: row.senseiId,
      senseiName: row.senseiName,
      completedSessions: 0,
      scheduledHours: 0,
      actualHours: 0,
      lateJoins: 0,
      senseiInitiatedSwaps: 0,
      senseiRelatedCancellations: 0
    };
    if (row.status === 'completed' || (row.status === 'active' && row.clockOut)) {
      current.completedSessions += 1;
    }
    current.scheduledHours += row.scheduledMinutes / 60;
    if (row.actualMinutes != null) current.actualHours += row.actualMinutes / 60;
    if (row.lateJoin === 'Yes') current.lateJoins += 1;
    if (row.swap.toLowerCase().includes('(sensei)')) current.senseiInitiatedSwaps += 1;
    if (row.status === 'cancelled' && /sensei/i.test(row.cancellation)) {
      current.senseiRelatedCancellations += 1;
    }
    map.set(row.senseiId, current);
  }
  return [...map.values()].sort((a, b) => a.senseiName.localeCompare(b.senseiName));
}

function csvEscape(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Excel-compatible CSV (UTF-8 BOM). No salary columns. */
export function eomRowsToCsv(rows: EomSessionRow[], summaries: EomSenseiSummary[]) {
  const detailHeader = [
    'Sensei',
    'Class',
    'Level',
    'Class Type',
    'Student(s)',
    'Scheduled Date',
    'Start',
    'End',
    'Clock In',
    'Clock Out',
    'Scheduled Duration (min)',
    'Actual Teaching Duration (min)',
    'Session X/X',
    'Session Status',
    'Late Join',
    'Late Minutes',
    'Swap',
    'Cancellation',
    'Replacement / Extra'
  ];
  const detailLines = [
    detailHeader.join(','),
    ...rows.map((row) =>
      [
        row.senseiName,
        row.className,
        row.level,
        row.classType,
        row.students,
        row.date,
        row.startTime,
        row.endTime,
        row.clockIn,
        row.clockOut,
        row.scheduledMinutes,
        row.actualMinutes ?? '',
        row.sessionLabel,
        row.status,
        row.lateJoin,
        row.lateMinutes,
        row.swap,
        row.cancellation,
        row.sessionKind
      ]
        .map(csvEscape)
        .join(',')
    )
  ];

  const summaryHeader = [
    'Sensei',
    'Total Completed Sessions',
    'Total Scheduled Teaching Hours',
    'Total Actual Teaching Hours',
    'Total Late Joins',
    'Total Sensei-Initiated Swaps',
    'Total Sensei-Related Cancellations'
  ];
  const summaryLines = [
    '',
    'SUMMARY PER SENSEI',
    summaryHeader.join(','),
    ...summaries.map((item) =>
      [
        item.senseiName,
        item.completedSessions,
        item.scheduledHours.toFixed(2),
        item.actualHours.toFixed(2),
        item.lateJoins,
        item.senseiInitiatedSwaps,
        item.senseiRelatedCancellations
      ]
        .map(csvEscape)
        .join(',')
    )
  ];

  return `\uFEFF${[...detailLines, ...summaryLines].join('\n')}`;
}

export function downloadEomExcel(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
