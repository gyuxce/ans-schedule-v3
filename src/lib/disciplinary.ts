import type { ClassSession, DisciplinaryMetrics, SessionLog } from '../types';
import { toDateKey } from './dates';

/** "YYYY-MM". A Date uses the local calendar, so the first morning of a month in WIB is not still last month. */
export function monthKey(date: Date | string) {
  const value = typeof date === 'string' ? date : toDateKey(date);
  return value.slice(0, 7);
}

/** A whole month ("2026-10") or an inclusive date range, either end may be left open. */
export type DisciplinePeriod = string | { from?: string; to?: string };

export function periodContains(period: DisciplinePeriod, date: string) {
  if (typeof period === 'string') return date.startsWith(period);
  if (period.from && date < period.from) return false;
  if (period.to && date > period.to) return false;
  return true;
}

export function getDisciplinaryMetrics(
  senseiId: string,
  period: DisciplinePeriod,
  schedules: ClassSession[],
  logs: SessionLog[]
): DisciplinaryMetrics {
  const inMonth = (date: string) => periodContains(period, date);

  const senseiInitiatedSwaps = schedules.filter((session) => {
    if (session.swapInitiator !== 'Sensei' || !inMonth(session.date)) return false;
    const attributableId = session.originalSenseiId ?? session.senseiId;
    return attributableId === senseiId;
  }).length;

  const cancelledNoReplacement = schedules.filter(
    (session) =>
      session.originalSenseiId === senseiId &&
      session.status === 'cancelled' &&
      session.cancellationInitiator === 'Sensei' &&
      session.replacementSecured === false &&
      inMonth(session.date)
  ).length;

  const lateJoins = logs.filter((log) => {
    if (log.senseiId !== senseiId || !log.lateJoin) return false;
    const session = schedules.find((item) => item.id === log.scheduleId);
    return session ? inMonth(session.date) : false;
  }).length;

  return {
    senseiId,
    month: typeof period === 'string' ? period : `${period.from ?? ''}..${period.to ?? ''}`,
    senseiInitiatedSwaps,
    cancelledNoReplacement,
    lateJoins
  };
}
