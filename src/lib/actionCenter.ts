import { addDays } from 'date-fns';
import type {
  ActionItem,
  AvailabilitySlot,
  ClassMaster,
  ClassSession,
  Enrollment,
  LeavePeriod,
  Sensei,
  SessionLog,
  SessionReport,
  Student
} from '../types';
import { WEEKLY_HOUR_TARGET } from '../constants';
import { getClassHealth } from './classProgress';
import { toDateKey, weekDays } from './dates';
import {
  deriveEnrollmentDisplayStatus,
  getEnrollmentProgress,
  isCurrentEnrollmentStatus
} from './enrollment';
import { getOperationalLabels } from './labels';
import { findConflicts } from './schedule';
import { getSessionWorkflow } from './session';
import { getWorkloadMetrics } from './workload';

/** Session-level ops alerts only for recent window (not full history after V2 import). */
const SESSION_ALERT_LOOKBACK_DAYS = 14;

export function buildActionItems(input: {
  sensei: Sensei[];
  schedules: ClassSession[];
  availability: AvailabilitySlot[];
  logs: SessionLog[];
  reports: SessionReport[];
  leavePeriods: LeavePeriod[];
  classMasters?: ClassMaster[];
  enrollments?: Enrollment[];
  students?: Student[];
  weekAnchor: Date | string;
  weeklyHourTarget?: number;
  now?: Date;
}): ActionItem[] {
  const items: ActionItem[] = [];
  const now = input.now ?? new Date();
  const weeklyHourTarget =
    input.weeklyHourTarget && input.weeklyHourTarget > 0 ? input.weeklyHourTarget : WEEKLY_HOUR_TARGET;
  const todayKey = toDateKey(now);
  const lookbackStart = toDateKey(addDays(now, -SESSION_ALERT_LOOKBACK_DAYS));
  const weekEnd = toDateKey(weekDays(input.weekAnchor)[6]);
  const classMasters = input.classMasters ?? [];
  const enrollments = input.enrollments ?? [];
  const students = input.students ?? [];

  for (const session of input.schedules) {
    if (session.status === 'cancelled') continue;
    // Skip ancient migrated sessions — Action Center is operational, not full archive.
    if (session.date < lookbackStart || session.date > weekEnd) continue;

    const log = input.logs.find((item) => item.scheduleId === session.id);
    const report = input.reports.find((item) => item.scheduleId === session.id);
    const workflow = getSessionWorkflow(session, log, report);
    const ended =
      `${session.date}T${session.endTime}:00` < now.toISOString().slice(0, 19) || session.date < todayKey;

    if (!report && (workflow === 'report_pending' || ended)) {
      items.push({
        id: `missing_report:${session.id}`,
        kind: 'missing_report',
        severity: 'high',
        title: 'Laporan sesi belum masuk',
        detail: `${session.level} · ${session.date} ${session.startTime}`,
        senseiId: session.senseiId,
        scheduleId: session.id,
        classId: session.classId ?? undefined
      });
    }

    if (report && report.recordingStatus === 'Missing') {
      items.push({
        id: `missing_recording:${session.id}`,
        kind: 'missing_recording',
        severity: 'medium',
        title: 'Referensi rekaman belum ada',
        detail: `${session.level} · perlu ditindaklanjuti sebelum QA`,
        senseiId: session.senseiId,
        scheduleId: session.id,
        classId: session.classId ?? undefined
      });
    }

    if (log?.lateJoin) {
      items.push({
        id: `late_join:${session.id}`,
        kind: 'late_join',
        severity: 'medium',
        title: 'Clock-in terlambat',
        detail: `${session.date} ${session.startTime} · bandingkan dengan jam mulai kelas`,
        senseiId: session.senseiId,
        scheduleId: session.id,
        classId: session.classId ?? undefined
      });
    }
  }

  for (const pair of findConflicts(input.schedules)) {
    if (pair.a.date < lookbackStart && pair.b.date < lookbackStart) continue;
    items.push({
      id: `conflict:${pair.a.id}:${pair.b.id}`,
      kind: 'schedule_conflict',
      severity: 'high',
      title: 'Konflik jadwal Sensei',
      detail: `${pair.a.date} ${pair.a.startTime}–${pair.a.endTime} bentrok dengan ${pair.b.startTime}–${pair.b.endTime}`,
      senseiId: pair.a.senseiId,
      scheduleId: pair.a.id
    });
  }

  for (const enrollment of enrollments) {
    if (!isCurrentEnrollmentStatus(enrollment.status)) continue;
    const display = deriveEnrollmentDisplayStatus(enrollment, input.schedules, input.reports, now);
    const progress = getEnrollmentProgress(enrollment, input.schedules, input.reports);
    const studentName = students.find((item) => item.id === enrollment.studentId)?.name ?? 'Siswa';
    if (display === 'ending_soon' && (progress.remaining == null || progress.remaining > 0)) {
      items.push({
        id: `ending_soon_enroll:${enrollment.id}`,
        kind: 'ending_soon',
        severity: 'medium',
        title: `${studentName} ending soon`,
        detail:
          progress.required > 0
            ? `${enrollment.level} · ${progress.completed}/${progress.required} sesi`
            : `${enrollment.level} · mendekati planned end`,
        senseiId: enrollment.senseiId ?? undefined,
        classId: enrollment.classId ?? undefined,
        studentId: enrollment.studentId,
        enrollmentId: enrollment.id
      });
    }
  }

  for (const teachingClass of classMasters) {
    const health = getClassHealth(teachingClass, input.schedules, input.reports, now);
    if (health.status === 'overdue') {
      items.push({
        id: `overdue:${teachingClass.id}`,
        kind: 'overdue_class',
        severity: 'high',
        title: `${teachingClass.displayName} overdue`,
        detail: health.detail,
        senseiId: teachingClass.senseiId,
        classId: teachingClass.id
      });
    }
  }

  for (const sensei of input.sensei) {
    const labels = getOperationalLabels(sensei, input.schedules, input.leavePeriods, now, classMasters);
    if (labels.includes('UNASSIGNED')) {
      items.push({
        id: `unassigned:${sensei.id}`,
        kind: 'unassigned_sensei',
        severity: 'medium',
        title: `${sensei.name} belum punya kelas aktif`,
        detail: 'Tinjau alokasi kelas untuk Sensei ACTIVE yang UNASSIGNED',
        senseiId: sensei.id
      });
    }

    const workload = getWorkloadMetrics(
      sensei.id,
      input.availability,
      input.schedules,
      input.weekAnchor,
      weeklyHourTarget
    );
    if (sensei.primaryStatus === 'ACTIVE' && !labels.includes('CUTI')) {
      if (workload.assignedHours < weeklyHourTarget) {
        items.push({
          id: `hours:${sensei.id}`,
          kind: 'hours_below_target',
          severity: workload.assignedHours === 0 ? 'high' : 'low',
          title: `${sensei.name} di bawah target ${weeklyHourTarget} jam`,
          detail: `${workload.assignedHours}/${weeklyHourTarget} jam terisi · sisa kapasitas ${Math.max(workload.remainingHours, 0)} jam`,
          senseiId: sensei.id
        });
      }
      if (workload.availableHours > 0 && workload.availableHours < weeklyHourTarget) {
        items.push({
          id: `low_avail:${sensei.id}`,
          kind: 'low_availability',
          severity: 'low',
          title: `${sensei.name} membuka ketersediaan terbatas`,
          detail: `${workload.availableHours} jam tersedia minggu ini`,
          senseiId: sensei.id
        });
      }
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export interface ActionGroup {
  kind: ActionItem['kind'];
  count: number;
  /** Highest severity present in the group. */
  severity: ActionItem['severity'];
  items: ActionItem[];
}

/** Collapse a flat action list into one card per kind, worst-first. */
export function groupActionItems(items: ActionItem[]): ActionGroup[] {
  const map = new Map<ActionItem['kind'], ActionGroup>();
  for (const item of items) {
    const group = map.get(item.kind);
    if (!group) {
      map.set(item.kind, { kind: item.kind, count: 1, severity: item.severity, items: [item] });
      continue;
    }
    group.count += 1;
    group.items.push(item);
    if (SEVERITY_RANK[item.severity] < SEVERITY_RANK[group.severity]) group.severity = item.severity;
  }
  return [...map.values()].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count
  );
}
