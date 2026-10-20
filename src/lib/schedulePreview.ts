import { format, parseISO } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import type { ClassSession } from '../types';
import { addMinutesToTime, generateRecurringDates } from './recurring';
import { findSameDayDuplicate } from './classSync';
import { findConflicts } from './schedule';

export type SchedulePreviewRow = {
  index: number;
  date: string;
  startTime: string;
  endTime: string;
  weekdayLabel: string;
  label: string;
};

export function buildRecurringPreview(input: {
  startDate: string;
  weekdays: number[];
  startTime: string;
  durationMinutes: number;
  requiredMeetings: number;
}): SchedulePreviewRow[] {
  const dates = generateRecurringDates(input.startDate, input.weekdays, input.requiredMeetings);
  const endTime = addMinutesToTime(input.startTime, input.durationMinutes);
  return dates.map((date, index) => {
    const day = parseISO(`${date}T00:00:00`);
    return {
      index: index + 1,
      date,
      startTime: input.startTime,
      endTime,
      weekdayLabel: format(day, 'EEE', { locale: localeId }),
      label: `${index + 1} / ${input.requiredMeetings}`
    };
  });
}

export function previewConflicts(
  existing: ClassSession[],
  preview: SchedulePreviewRow[],
  senseiId: string,
  studentIds: string[],
  type: ClassSession['type'],
  level: string
) {
  const candidates: ClassSession[] = preview.map((row, index) => ({
    id: `preview-${index}`,
    senseiId,
    studentIds,
    type,
    level,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    status: 'active'
  }));
  const conflicts: Array<{
    kind: 'overlap' | 'duplicate';
    date: string;
    startTime: string;
    withDate: string;
    withStart: string;
  }> = [];
  let pool = [...existing];
  for (const candidate of candidates) {
    const hits = findConflicts(pool, candidate).filter(
      (pair) => pair.a.id === candidate.id || pair.b.id === candidate.id
    );
    for (const hit of hits) {
      const other = hit.a.id === candidate.id ? hit.b : hit.a;
      conflicts.push({
        kind: 'overlap',
        date: candidate.date,
        startTime: candidate.startTime,
        withDate: other.date,
        withStart: other.startTime
      });
    }
    if (!hits.length) {
      const duplicate = findSameDayDuplicate(pool, candidate);
      if (duplicate) {
        conflicts.push({
          kind: 'duplicate',
          date: candidate.date,
          startTime: candidate.startTime,
          withDate: duplicate.date,
          withStart: duplicate.startTime
        });
      }
    }
    pool = [...pool, candidate];
  }
  return conflicts;
}

export function formatPreviewDate(date: string) {
  return format(parseISO(`${date}T00:00:00`), 'EEE, d MMM yyyy', { locale: localeId });
}
