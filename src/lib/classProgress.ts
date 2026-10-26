import type { ClassMaster, ClassSession, SessionReport } from '../types';
import { toDateKey } from './dates';

/** A session skipped on purpose (izin / loncat sesi): cancelled, but it still takes a number. */
export function isSkippedSession(session: ClassSession) {
  return session.status === 'cancelled' && session.cancellationInitiator === 'Izin';
}

/** Calendar sessions plus skipped ones: both occupy a number in "Sesi N dari Y". */
export function classNumberedSessions(classId: string, schedules: ClassSession[]) {
  return schedules
    .filter(
      (session) =>
        session.classId === classId &&
        !session.isExtra &&
        (session.status !== 'cancelled' || isSkippedSession(session))
    )
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
}

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
  const skipped = schedules.filter(
    (session) => session.classId === teachingClass.id && !session.isExtra && isSkippedSession(session)
  ).length;
  return {
    required,
    completed,
    remaining,
    skipped,
    /** Sessions used up: delivered + skipped (what the team reads as the "3/10" numerator). */
    consumed: completed + skipped,
    /** Required plus one slot per skipped session (the "/10" that becomes "/11"). */
    totalSlots: required + skipped,
    calendarCount: calendar.length,
    completedSessions,
    calendar
  };
}

/**
 * Session X of Y — X is the position among the class's numbered sessions (not
 * cancelled, not extra, plus skipped/izin ones), not how many were delivered.
 * Y grows by one for every skipped session. When earlier past sessions never got
 * a report the position and the delivered count diverge, so the label also says
 * how many are done.
 */
export function getSessionOrdinal(
  session: ClassSession,
  schedules: ClassSession[],
  teachingClass?: ClassMaster | null,
  reports: SessionReport[] = [],
  today = toDateKey(new Date())
) {
  if (!session.classId || !teachingClass) return null;
  const numbered = classNumberedSessions(session.classId, schedules);
  const skipped = numbered.filter(isSkippedSession).length;
  const total = teachingClass.requiredMeetings + skipped;
  if (session.isExtra) {
    return { index: 0, required: total, completed: 0, unreportedBefore: 0, label: 'Extra' };
  }
  const index = numbered.findIndex((item) => item.id === session.id);
  if (index < 0) return null;
  const completed = numbered.filter((item) => isSessionCompleted(item, reports)).length;
  const unreportedBefore = numbered
    .slice(0, index)
    .filter(
      (item) => !isSkippedSession(item) && !isSessionCompleted(item, reports) && item.date < today
    ).length;
  const base = `Sesi ${index + 1} dari ${total}`;
  return {
    index: index + 1,
    required: total,
    completed,
    unreportedBefore,
    label: unreportedBefore > 0 ? `${base} · ${completed} selesai` : base
  };
}

/**
 * True when the session really did not take place: skipped with izin, or reported
 * with every student excused / absent. A plain cancellation (schedule fix, regenerate,
 * class transfer) is a calendar change, not a miss.
 */
export function isNotRunSession(session: ClassSession, reports: SessionReport[]) {
  if (session.status === 'cancelled') return isSkippedSession(session);
  const report = reports.find((item) => item.scheduleId === session.id);
  return Boolean(
    report &&
    report.students.length > 0 &&
    report.students.every((item) => item.attendance === 'Excused' || item.attendance === 'Absent')
  );
}

/**
 * How many of the class's most recent past sessions in a row did not run.
 * Plain cancelled sessions are ignored (neither counted nor breaking the streak);
 * a past session that ran, or whose report is simply missing, ends it.
 */
export function getNotRunningStreak(
  classId: string,
  schedules: ClassSession[],
  reports: SessionReport[],
  today = toDateKey(new Date())
) {
  const past = schedules
    .filter((session) => session.classId === classId && !session.isExtra && session.date < today)
    .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`));
  const sessions: ClassSession[] = [];
  for (const session of past) {
    if (session.status === 'cancelled' && !isSkippedSession(session)) continue;
    if (!isNotRunSession(session, reports)) break;
    sessions.push(session);
  }
  return { streak: sessions.length, sessions };
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
