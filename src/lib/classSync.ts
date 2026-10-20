import type { ClassSession, SessionReport } from '../types';
import { wouldConflict } from './schedule';

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** Still ahead of us: active, on/after the cutoff date, and no report filed yet. */
function isOpenFrom(session: ClassSession, reports: SessionReport[], fromDate: string) {
  return (
    session.status === 'active' &&
    session.date >= fromDate &&
    !reports.some((report) => report.scheduleId === session.id)
  );
}

/** Upcoming sessions of a class whose student list no longer matches the Class Master. */
export function syncUpcomingSessionStudents(input: {
  schedules: ClassSession[];
  reports: SessionReport[];
  classId: string;
  studentIds: string[];
  today: string;
  updatedBy?: string;
}): ClassSession[] {
  const updatedAt = new Date().toISOString();
  return input.schedules
    .filter(
      (session) =>
        session.classId === input.classId &&
        isOpenFrom(session, input.reports, input.today) &&
        !sameIds(session.studentIds, input.studentIds)
    )
    .map((session) => ({
      ...session,
      studentIds: [...input.studentIds],
      updatedAt,
      updatedBy: input.updatedBy
    }));
}

/** Hand a class's remaining sessions to a new Sensei; past sessions stay with the old one. */
export function planClassTakeOver(input: {
  schedules: ClassSession[];
  reports: SessionReport[];
  classId: string;
  newSenseiId: string;
  effectiveDate: string;
  reason: string;
  updatedBy?: string;
}): { moved: ClassSession[]; conflicts: ClassSession[] } {
  const updatedAt = new Date().toISOString();
  const moved = input.schedules
    .filter(
      (session) =>
        session.classId === input.classId &&
        session.senseiId !== input.newSenseiId &&
        isOpenFrom(session, input.reports, input.effectiveDate)
    )
    .map<ClassSession>((session) => ({
      ...session,
      originalSenseiId: session.originalSenseiId ?? session.senseiId,
      senseiId: input.newSenseiId,
      swapInitiator: 'Admin',
      swapReason: `Take over: ${input.reason}`,
      updatedAt,
      updatedBy: input.updatedBy
    }));

  const movedById = new Map(moved.map((session) => [session.id, session]));
  const after = input.schedules.map((session) => movedById.get(session.id) ?? session);
  const conflicts = moved.filter((session) => wouldConflict(after, session));
  return { moved, conflicts };
}

/** Upcoming open sessions of a class, marked cancelled (used when the Class Master is cancelled). */
export function cancelUpcomingSessionsOfClass(input: {
  schedules: ClassSession[];
  reports: SessionReport[];
  classId: string;
  today: string;
  reason: string;
  updatedBy?: string;
}): ClassSession[] {
  const updatedAt = new Date().toISOString();
  return input.schedules
    .filter((session) => session.classId === input.classId && isOpenFrom(session, input.reports, input.today))
    .map<ClassSession>((session) => ({
      ...session,
      status: 'cancelled',
      cancellationReason: input.reason,
      cancellationInitiator: 'Admin',
      replacementSecured: false,
      updatedAt,
      updatedBy: input.updatedBy
    }));
}

/**
 * Same Sensei, same day, at least one shared student, in a different class —
 * usually a class entered twice with different times (no time overlap, so the
 * normal conflict check misses it).
 */
export function findSameDayDuplicate(
  existing: ClassSession[],
  candidate: { senseiId: string; studentIds: string[]; date: string; classId?: string | null }
) {
  return existing.find(
    (session) =>
      session.status !== 'cancelled' &&
      !session.isExtra &&
      session.date === candidate.date &&
      session.senseiId === candidate.senseiId &&
      (candidate.classId == null || session.classId !== candidate.classId) &&
      session.studentIds.some((id) => candidate.studentIds.includes(id))
  );
}
