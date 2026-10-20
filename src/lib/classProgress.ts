import type { ClassMaster, ClassSession, SessionReport } from '../types';
import { toDateKey } from './dates';

/** Non-cancelled academic calendar sessions (excludes Extra meetings). */
export function classCalendarSessions(classId: string, schedules: ClassSession[]) {
  return schedules
    .filter((session) => session.classId === classId && session.status !== 'cancelled' && !session.isExtra)
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
}

export function isSessionCompleted(session: ClassSession, reports: SessionReport[]) {
  if (session.status === 'cancelled') return false;
  if (session.status === 'completed') return true;
  return reports.some((report) => report.scheduleId === session.id);
}

export type SessionStripState = 'completed' | 'due' | 'next' | 'scheduled' | 'empty';

export interface SessionStripCell {
  index: number;
  state: SessionStripState;
  date?: string;
  sessionId?: string;
}

/** One cell per required meeting: done, overdue, next, scheduled, or not generated. */
export function getSessionStrip(
  teachingClass: ClassMaster,
  schedules: ClassSession[],
  reports: SessionReport[],
  today = toDateKey(new Date())
): SessionStripCell[] {
  const progress = getClassProgress(teachingClass, schedules, reports);
  let nextMarked = false;
  return Array.from({ length: Math.max(progress.required, 0) }, (_, index) => {
    const session = progress.calendar[index];
    if (!session) {
      return { index: index + 1, state: 'empty' as const };
    }
    if (isSessionCompleted(session, reports)) {
      return { index: index + 1, state: 'completed' as const, date: session.date, sessionId: session.id };
    }
    if (session.date < today) {
      return { index: index + 1, state: 'due' as const, date: session.date, sessionId: session.id };
    }
    if (!nextMarked) {
      nextMarked = true;
      return { index: index + 1, state: 'next' as const, date: session.date, sessionId: session.id };
    }
    return { index: index + 1, state: 'scheduled' as const, date: session.date, sessionId: session.id };
  });
}

export function getClassProgress(
  teachingClass: ClassMaster,
  schedules: ClassSession[],
  reports: SessionReport[]
) {
  const calendar = classCalendarSessions(teachingClass.id, schedules);
  const completedSessions = calendar.filter((session) => isSessionCompleted(session, reports));
  const completed = completedSessions.length;
  const required = teachingClass.requiredMeetings;
  const remaining = Math.max(required - completed, 0);
  return {
    required,
    completed,
    remaining,
    calendarCount: calendar.length,
    completedSessions,
    calendar
  };
}

/**
 * Session X of required Y — X is the position among non-cancelled non-extra
 * sessions, not how many were actually delivered. When earlier past sessions
 * never got a report the two diverge, so the label also says how many are done.
 */
export function getSessionOrdinal(
  session: ClassSession,
  schedules: ClassSession[],
  teachingClass?: ClassMaster | null,
  reports: SessionReport[] = [],
  today = toDateKey(new Date())
) {
  if (!session.classId || !teachingClass) return null;
  const required = teachingClass.requiredMeetings;
  if (session.isExtra) {
    return { index: 0, required, completed: 0, unreportedBefore: 0, label: 'Extra' };
  }
  const calendar = classCalendarSessions(session.classId, schedules);
  const index = calendar.findIndex((item) => item.id === session.id);
  if (index < 0) return null;
  const completed = calendar.filter((item) => isSessionCompleted(item, reports)).length;
  const unreportedBefore = calendar
    .slice(0, index)
    .filter((item) => !isSessionCompleted(item, reports) && item.date < today).length;
  const base = `Sesi ${index + 1} dari ${required}`;
  return {
    index: index + 1,
    required,
    completed,
    unreportedBefore,
    label: unreportedBefore > 0 ? `${base} · ${completed} selesai` : base
  };
}

export function computeProjectedEndDate(classId: string, schedules: ClassSession[]) {
  const calendar = classCalendarSessions(classId, schedules);
  if (!calendar.length) return null;
  return calendar[calendar.length - 1]?.date ?? null;
}

export type ClassHealthStatus = 'on_track' | 'ending_soon' | 'delayed' | 'overdue' | 'completed' | 'inactive';

export function getClassHealth(
  teachingClass: ClassMaster,
  schedules: ClassSession[],
  reports: SessionReport[],
  now = new Date()
): { status: ClassHealthStatus; detail: string } {
  if (teachingClass.status === 'cancelled' || teachingClass.status === 'draft') {
    return { status: 'inactive', detail: `Status kelas: ${teachingClass.status}` };
  }
  const progress = getClassProgress(teachingClass, schedules, reports);
  if (teachingClass.status === 'completed' || progress.completed >= progress.required) {
    return { status: 'completed', detail: `${progress.completed}/${progress.required} sesi selesai` };
  }

  const today = now.toISOString().slice(0, 10);
  const plannedEnd = teachingClass.plannedEndDate;
  const projectedEnd = teachingClass.projectedEndDate || computeProjectedEndDate(teachingClass.id, schedules);

  if (plannedEnd && plannedEnd < today && progress.remaining > 0) {
    return {
      status: 'overdue',
      detail:
        `Original plan ${plannedEnd} lewat · sisa ${progress.remaining} sesi` +
        (projectedEnd ? ` · projected ${projectedEnd}` : '')
    };
  }

  if (progress.remaining <= 2 || (plannedEnd && daysUntil(plannedEnd, today) <= 7)) {
    return {
      status: 'ending_soon',
      detail: `ENDING SOON — ${progress.completed}/${progress.required}`
    };
  }

  if (projectedEnd && plannedEnd && projectedEnd > plannedEnd && progress.remaining > 0) {
    return {
      status: 'delayed',
      detail: `Original ${plannedEnd} · projected ${projectedEnd} · ${progress.completed}/${progress.required}`
    };
  }

  if (plannedEnd && daysUntil(plannedEnd, today) <= 14 && progress.completed < progress.required / 2) {
    return {
      status: 'delayed',
      detail: `Progres ${progress.completed}/${progress.required} · rencana ${plannedEnd}`
    };
  }

  return {
    status: 'on_track',
    detail: `${progress.completed}/${progress.required} sesi selesai`
  };
}

function daysUntil(date: string, today: string) {
  const a = new Date(`${today}T00:00:00`).getTime();
  const b = new Date(`${date}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}
