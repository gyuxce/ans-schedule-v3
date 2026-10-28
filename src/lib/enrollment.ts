import type { ClassMaster, ClassSession, Enrollment, EnrollmentStatus, SessionReport } from '../types';
import { toDateKey } from './dates';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function isCurrentEnrollmentStatus(status: EnrollmentStatus) {
  return status === 'active' || status === 'ending_soon';
}

/** Still marked active, but its class is already completed or cancelled: a leftover that was never closed. */
export function isEnrollmentStale(enrollment: Enrollment, classMasters: ClassMaster[]) {
  if (!enrollment.classId) return false;
  const teachingClass = classMasters.find((item) => item.id === enrollment.classId);
  return teachingClass?.status === 'completed' || teachingClass?.status === 'cancelled';
}

/**
 * The enrollment to show as a student's current one when several are marked active:
 * not stale first, then one whose class is running, then the most recently started.
 */
export function pickCurrentEnrollment(enrollments: Enrollment[], classMasters: ClassMaster[]) {
  const current = enrollments.filter((item) => isCurrentEnrollmentStatus(item.status));
  const rank = (item: Enrollment) => {
    if (isEnrollmentStale(item, classMasters)) return 2;
    const teachingClass = classMasters.find((cm) => cm.id === item.classId);
    return teachingClass?.status === 'active' || teachingClass?.status === 'ready' ? 0 : 1;
  };
  return [...current].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return (b.startDate || b.updatedAt || '').localeCompare(a.startDate || a.updatedAt || '');
  })[0];
}

export function findActiveEnrollment(enrollments: Enrollment[], studentId: string, level?: string) {
  return enrollments.find(
    (item) =>
      item.studentId === studentId &&
      isCurrentEnrollmentStatus(item.status) &&
      (level == null || item.level === level)
  );
}

/**
 * A session counts toward an enrollment when it belongs to the enrollment's class.
 * The level label is only compared for sessions that are not tied to a class, since
 * a Class Master edited after its sessions were generated can disagree with them.
 */
function sessionBelongsToEnrollment(session: ClassSession, enrollment: Enrollment) {
  if (session.status === 'cancelled') return false;
  if (!session.studentIds.includes(enrollment.studentId)) return false;
  if (enrollment.classId && session.classId) return session.classId === enrollment.classId;
  return session.level === enrollment.level;
}

export function countEnrollmentSessionsCompleted(
  enrollment: Enrollment,
  schedules: ClassSession[],
  reports: SessionReport[]
) {
  const computed = schedules.filter((session) => {
    if (!sessionBelongsToEnrollment(session, enrollment)) return false;
    const report = reports.find((item) => item.scheduleId === session.id);
    return Boolean(report) || session.status === 'completed';
  }).length;
  // Prefer the stored value when Ops set it, but never undercount completed reports for the journey.
  if (typeof enrollment.sessionsCompleted === 'number' && enrollment.sessionsCompleted >= 0) {
    return Math.max(enrollment.sessionsCompleted, computed);
  }
  return computed;
}

export function getEnrollmentProgress(
  enrollment: Enrollment,
  schedules: ClassSession[],
  reports: SessionReport[]
) {
  const required = Math.max(0, enrollment.requiredMeetings ?? 0);
  const completed = countEnrollmentSessionsCompleted(enrollment, schedules, reports);
  const remaining = required > 0 ? Math.max(required - completed, 0) : null;
  return { required, completed, remaining };
}

export function deriveEnrollmentDisplayStatus(
  enrollment: Enrollment,
  schedules: ClassSession[],
  reports: SessionReport[],
  now = new Date()
): EnrollmentStatus {
  if (!isCurrentEnrollmentStatus(enrollment.status)) return enrollment.status;
  const { required, completed, remaining } = getEnrollmentProgress(enrollment, schedules, reports);
  const today = toDateKey(now);
  const plannedSoon =
    Boolean(enrollment.plannedEndDate) &&
    enrollment.plannedEndDate! >= today &&
    (new Date(`${enrollment.plannedEndDate}T00:00:00`).getTime() - now.getTime()) / 86400000 <= 7;

  if (required > 0 && remaining != null && remaining > 0 && remaining <= 2) return 'ending_soon';
  // A class that has not delivered a single session is not "almost finished", whatever its planned end says.
  if (plannedSoon && completed > 0 && (remaining == null || remaining > 0)) return 'ending_soon';
  if (required > 0 && completed >= required)
    return enrollment.status === 'ending_soon' ? 'ending_soon' : 'active';
  return enrollment.status === 'ending_soon' ? 'active' : enrollment.status;
}

/** Close current enrollment for a level; optionally open next. Never overwrites history. */
export function progressEnrollmentJourney(input: {
  enrollments: Enrollment[];
  studentId: string;
  completedLevel: string;
  nextLevel: string | null;
  createId: () => string;
  actorName?: string;
  classType?: Enrollment['classType'];
  senseiId?: string | null;
  classId?: string | null;
  /** Target meetings for the newly-opened next level — usually the next class's requiredMeetings. */
  requiredMeetings?: number | null;
  plannedEndDate?: string | null;
  notes?: string;
}): { enrollments: Enrollment[]; changed: Enrollment[] } {
  const now = new Date().toISOString();
  const endDate = todayIsoDate();
  const changed: Enrollment[] = [];
  let next = input.enrollments.map((item) => {
    if (
      item.studentId === input.studentId &&
      item.level === input.completedLevel &&
      isCurrentEnrollmentStatus(item.status)
    ) {
      const closed: Enrollment = {
        ...item,
        status: 'completed',
        endDate,
        notes: input.notes ? [item.notes, input.notes].filter(Boolean).join(' · ') : item.notes,
        updatedAt: now,
        updatedBy: input.actorName
      };
      changed.push(closed);
      return closed;
    }
    return item;
  });

  if (input.nextLevel) {
    const existingActiveNext = findActiveEnrollment(next, input.studentId, input.nextLevel);
    if (!existingActiveNext) {
      const opened: Enrollment = {
        id: input.createId(),
        studentId: input.studentId,
        level: input.nextLevel,
        classType: input.classType ?? null,
        classId: input.classId ?? null,
        senseiId: input.senseiId ?? null,
        status: 'active',
        startDate: endDate,
        endDate: null,
        plannedEndDate: input.plannedEndDate ?? null,
        requiredMeetings: input.requiredMeetings ?? null,
        sessionsCompleted: 0,
        paymentStatus: 'BELUM_BAYAR',
        notes: input.notes,
        updatedAt: now,
        updatedBy: input.actorName
      };
      changed.push(opened);
      next = [opened, ...next];
    }
  }

  return { enrollments: next, changed };
}

/** Ensure each class student has an active enrollment for the class level (additive). */
export function ensureClassEnrollments(input: {
  enrollments: Enrollment[];
  teachingClass: ClassMaster;
  createId: () => string;
  actorName?: string;
}): { enrollments: Enrollment[]; changed: Enrollment[] } {
  const now = new Date().toISOString();
  const startDate = input.teachingClass.startDate || todayIsoDate();
  const changed: Enrollment[] = [];
  let next = [...input.enrollments];

  for (const studentId of input.teachingClass.studentIds) {
    const activeSameLevel = findActiveEnrollment(next, studentId, input.teachingClass.level);
    if (activeSameLevel) {
      const linked: Enrollment = {
        ...activeSameLevel,
        classId: input.teachingClass.id,
        senseiId: input.teachingClass.senseiId,
        classType: input.teachingClass.type,
        requiredMeetings: activeSameLevel.requiredMeetings ?? input.teachingClass.requiredMeetings,
        plannedEndDate: activeSameLevel.plannedEndDate ?? input.teachingClass.plannedEndDate ?? null,
        updatedAt: now,
        updatedBy: input.actorName
      };
      if (
        linked.classId !== activeSameLevel.classId ||
        linked.senseiId !== activeSameLevel.senseiId ||
        linked.requiredMeetings !== activeSameLevel.requiredMeetings ||
        linked.plannedEndDate !== activeSameLevel.plannedEndDate
      ) {
        changed.push(linked);
        next = next.map((item) => (item.id === linked.id ? linked : item));
      }
      continue;
    }

    const opened: Enrollment = {
      id: input.createId(),
      studentId,
      level: input.teachingClass.level,
      classType: input.teachingClass.type,
      classId: input.teachingClass.id,
      senseiId: input.teachingClass.senseiId,
      status: 'active',
      startDate,
      endDate: null,
      plannedEndDate: input.teachingClass.plannedEndDate ?? null,
      requiredMeetings: input.teachingClass.requiredMeetings,
      sessionsCompleted: 0,
      paymentStatus: 'BELUM_BAYAR',
      updatedAt: now,
      updatedBy: input.actorName
    };
    changed.push(opened);
    next = [opened, ...next];
  }

  return { enrollments: next, changed };
}
