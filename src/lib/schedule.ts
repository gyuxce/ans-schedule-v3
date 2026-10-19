import type { ClassSession } from '../types';
import { timesOverlap } from './dates';

export function findConflicts(schedules: ClassSession[], candidate?: ClassSession) {
  const active = schedules.filter((session) => session.status !== 'cancelled');
  const conflicts: Array<{ a: ClassSession; b: ClassSession }> = [];

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      if (a.senseiId !== b.senseiId || a.date !== b.date) continue;
      if (timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
        conflicts.push({ a, b });
      }
    }
  }

  if (candidate && candidate.status !== 'cancelled') {
    for (const session of active) {
      if (session.id === candidate.id) continue;
      if (session.senseiId !== candidate.senseiId || session.date !== candidate.date) continue;
      if (timesOverlap(session.startTime, session.endTime, candidate.startTime, candidate.endTime)) {
        conflicts.push({ a: session, b: candidate });
      }
    }
  }

  return conflicts;
}

export function wouldConflict(schedules: ClassSession[], candidate: ClassSession) {
  return findConflicts(schedules, candidate).some(
    (pair) => pair.a.id === candidate.id || pair.b.id === candidate.id
  );
}

/** Sessions copy studentIds/senseiId from the Class Master when generated, so
 *  editing the Class Master later must carry the change onto sessions that
 *  haven't happened yet. Past/completed/cancelled sessions keep their snapshot
 *  (history), a student's per-session removal survives (we apply the diff, not
 *  a full overwrite), and a session already swapped to another Sensei keeps
 *  that Sensei. Returns only the sessions that actually changed. */
export function propagateClassMasterChange(
  schedules: ClassSession[],
  classId: string,
  previous: { senseiId: string; studentIds: string[] },
  next: { senseiId: string; studentIds: string[] },
  today: string
): ClassSession[] {
  const added = next.studentIds.filter((id) => !previous.studentIds.includes(id));
  const removed = previous.studentIds.filter((id) => !next.studentIds.includes(id));
  const senseiChanged = previous.senseiId !== next.senseiId;
  if (!added.length && !removed.length && !senseiChanged) return [];

  const changed: ClassSession[] = [];
  for (const session of schedules) {
    if (session.classId !== classId || session.status !== 'active' || session.date < today) continue;
    const studentIds = [...session.studentIds, ...added.filter((id) => !session.studentIds.includes(id))].filter(
      (id) => !removed.includes(id)
    );
    const senseiId = senseiChanged && session.senseiId === previous.senseiId ? next.senseiId : session.senseiId;
    const studentsChanged =
      studentIds.length !== session.studentIds.length || studentIds.some((id, i) => id !== session.studentIds[i]);
    if (!studentsChanged && senseiId === session.senseiId) continue;
    changed.push({ ...session, studentIds, senseiId });
  }
  return changed;
}
