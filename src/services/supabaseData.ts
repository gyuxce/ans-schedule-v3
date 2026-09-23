import type {
  AppSettings,
  ClassMaster,
  DashboardSnapshot,
  Enrollment,
  LevelCompletion,
  Sensei,
  SenseiTimezone,
  Student,
  UserAccount
} from '../types';
import { WEEKLY_HOUR_TARGET } from '../constants';
import {
  availabilityToRow,
  classMasterToRow,
  enrollmentToRow,
  mapAudit,
  mapAvailability,
  mapClassMaster,
  mapEnrollment,
  mapLeaveFromStatus,
  mapLevelCompletion,
  mapProfile,
  mapQaScore,
  mapSchedule,
  mapSensei,
  mapSenseiWithStatus,
  mapSessionLog,
  mapSessionReport,
  mapStudent,
  scheduleToRow,
  senseiToRow,
  studentToRow
} from '../lib/mappers';
import { resolveSenseiId } from '../lib/senseiLink';
import { getSupabase } from '../lib/supabase';
import type { AvailabilitySlot, ClassSession, SessionLog, SessionReport, TeachingQaScore } from '../types';

const DEFAULT_SETTINGS: AppSettings = {
  lateGraceMinutes: 0,
  minAttendancePercent: null,
  weeklyHourTarget: WEEKLY_HOUR_TARGET
};

function parseSettings(rows: Record<string, unknown>[]): AppSettings {
  const byKey = new Map(rows.map((row) => [String(row.key), row.value]));
  const readNumber = (key: string) => {
    const raw = byKey.get(key);
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const grace = readNumber('late_grace_minutes');
  const weekly = readNumber('weekly_hour_target');
  const minAttendance = readNumber('min_attendance_percent');

  return {
    ...DEFAULT_SETTINGS,
    lateGraceMinutes: grace !== null && grace >= 0 ? grace : DEFAULT_SETTINGS.lateGraceMinutes,
    weeklyHourTarget: weekly !== null && weekly > 0 ? weekly : DEFAULT_SETTINGS.weeklyHourTarget,
    minAttendancePercent:
      minAttendance !== null && minAttendance >= 0 && minAttendance <= 100 ? minAttendance : null
  };
}

export async function loadDashboardSnapshot(): Promise<DashboardSnapshot | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const [
    senseiRes,
    statusRes,
    studentsRes,
    groupsRes,
    schedulesRes,
    availabilityRes,
    logsRes,
    reportsRes,
    studentRecordsRes,
    qaRes,
    auditRes,
    profilesRes,
    settingsRes,
    levelRes,
    classRes,
    enrollmentRes
  ] = await Promise.all([
    supabase.from('sensei').select('*'),
    supabase.from('sensei_status').select('*'),
    supabase.from('students').select('*'),
    supabase.from('groups').select('*'),
    supabase.from('schedules').select('*').order('date', { ascending: true }),
    supabase.from('sensei_availability').select('*'),
    supabase.from('session_logs').select('*'),
    supabase.from('session_reports').select('*'),
    supabase.from('session_student_records').select('*'),
    supabase.from('teaching_qa_scores').select('*'),
    supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('profiles').select('*'),
    supabase.from('app_settings').select('key, value'),
    supabase.from('level_completions').select('*').order('completed_at', { ascending: false }),
    supabase.from('class_masters').select('*').order('updated_at', { ascending: false }),
    supabase.from('enrollments').select('*').order('updated_at', { ascending: false })
  ]);

  // Degrade gracefully: one slow / timed-out table shouldn't blank the whole
  // dashboard. Only a total failure (can't even read sensei + profiles) throws.
  const named: Array<[string, { error: { message: string } | null }]> = [
    ['sensei', senseiRes],
    ['sensei_status', statusRes],
    ['students', studentsRes],
    ['groups', groupsRes],
    ['schedules', schedulesRes],
    ['sensei_availability', availabilityRes],
    ['session_logs', logsRes],
    ['session_reports', reportsRes],
    ['session_student_records', studentRecordsRes],
    ['teaching_qa_scores', qaRes],
    ['audit_logs', auditRes],
    ['profiles', profilesRes]
  ];
  for (const [name, result] of named) {
    if (result.error) console.warn(`loadDashboardSnapshot: ${name} — ${result.error.message}`);
  }
  if (senseiRes.error && profilesRes.error) {
    throw new Error(senseiRes.error.message);
  }

  const statusBySensei = new Map(
    ((statusRes.data || []) as Record<string, unknown>[]).map((row) => [String(row.sensei_id), row])
  );
  const sensei = ((senseiRes.data || []) as Record<string, unknown>[]).map((row) =>
    mapSenseiWithStatus(mapSensei(row), statusBySensei.get(String(row.id)))
  );

  const students = ((studentsRes.data || []) as Record<string, unknown>[]).map((row) => {
    const mapped = mapStudent(row);
    const senseiName = String(row.sensei_name || '');
    const match = sensei.find((item) => item.name.toLowerCase() === senseiName.toLowerCase());
    return { ...mapped, senseiId: match?.id };
  });

  const leavePeriods = ((statusRes.data || []) as Record<string, unknown>[])
    .map((row) => mapLeaveFromStatus(row))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const reports = ((reportsRes.data || []) as Record<string, unknown>[]).map((row) => {
    const related = ((studentRecordsRes.data || []) as Record<string, unknown>[]).filter(
      (item) => String(item.session_report_id) === String(row.id)
    );
    return mapSessionReport(row, related);
  });

  const users: UserAccount[] = ((profilesRes.data || []) as Record<string, unknown>[]).map((row) => {
    const email = String(row.email || '').toLowerCase();
    const linked = resolveSenseiId(sensei, {
      senseiId: row.sensei_id ? String(row.sensei_id) : null,
      email
    });
    const linkedSensei = sensei.find((item) => item.id === linked);
    return {
      ...mapProfile(row, linked),
      name: linkedSensei?.name || String(row.email || '').split('@')[0]
    };
  });

  const settings = settingsRes.error
    ? DEFAULT_SETTINGS
    : parseSettings((settingsRes.data || []) as Record<string, unknown>[]);

  const levelCompletions = levelRes.error
    ? []
    : ((levelRes.data || []) as Record<string, unknown>[]).map(mapLevelCompletion);

  const classMasters = classRes.error
    ? []
    : ((classRes.data || []) as Record<string, unknown>[]).map(mapClassMaster);

  const enrollments = enrollmentRes.error
    ? []
    : ((enrollmentRes.data || []) as Record<string, unknown>[]).map(mapEnrollment);

  return {
    users,
    sensei,
    students,
    groups: ((groupsRes.data || []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name || ''),
      studentIds: Array.isArray(row.student_ids) ? row.student_ids.map(String) : [],
      level: ''
    })),
    classMasters,
    availability: ((availabilityRes.data || []) as Record<string, unknown>[]).map(mapAvailability),
    schedules: ((schedulesRes.data || []) as Record<string, unknown>[]).map(mapSchedule),
    sessionLogs: ((logsRes.data || []) as Record<string, unknown>[]).map(mapSessionLog),
    sessionReports: reports,
    qaScores: ((qaRes.data || []) as Record<string, unknown>[]).map(mapQaScore),
    leavePeriods,
    auditLogs: ((auditRes.data || []) as Record<string, unknown>[]).map(mapAudit),
    levelCompletions,
    enrollments,
    settings
  };
}

export async function updateProfileRemote(
  userId: string,
  patch: { role?: string; status?: string; sensei_id?: string | null }
) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function deleteProfileRemote(userId: string) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('profiles').delete().eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function deleteSenseiRemote(senseiId: string) {
  const supabase = getSupabase();
  if (!supabase) return;
  // sensei_status FK cascades; sensei_availability / session_logs are guarded in the store.
  const { error } = await supabase.from('sensei').delete().eq('id', senseiId);
  if (error) throw new Error(error.message);
}

export async function deleteStudentRemote(studentId: string) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('students').delete().eq('id', studentId);
  if (error) throw new Error(error.message);
}

export async function deleteClassMasterRemote(classId: string) {
  const supabase = getSupabase();
  if (!supabase) return;
  // schedules.class_id / enrollments.class_id are guarded in the store — this only
  // runs once neither table has any row left pointing at this class.
  const { error } = await supabase.from('class_masters').delete().eq('id', classId);
  if (error) throw new Error(error.message);
}

export async function ensureProfile(userId: string, email: string) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const existing = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (existing.data) return existing.data;

  const payload = {
    id: userId,
    email,
    role: 'Sensei',
    status: 'Pending'
  };
  const inserted = await supabase.from('profiles').insert(payload).select('*').single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data;
}

export async function writeAudit(input: {
  actorId?: string;
  actorEmail?: string;
  action: string;
  entity: string;
  recordId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
}) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from('audit_logs').insert({
    actor_id: input.actorId || null,
    actor_email: input.actorEmail || null,
    action: input.action,
    collection_name: input.entity,
    record_id: input.recordId,
    payload: {
      old: input.oldValue,
      new: input.newValue,
      reason: input.reason
    }
  });
}

export async function upsertScheduleRemote(session: ClassSession) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('schedules').upsert(scheduleToRow(session));
  if (error) throw new Error(error.message);
}

/**
 * True UPDATE (not upsert) for a schedule that is known to already exist.
 * Sensei are allowed to UPDATE their own schedule row (RLS: v3_schedules_update_own)
 * but not INSERT one — `.upsert()` evaluates the INSERT policy too (Postgres runs
 * ON CONFLICT DO UPDATE through the INSERT check), so it 403s for a Sensei even
 * when the row already exists. Use this for Sensei-reachable status flips
 * (e.g. submitSessionReport marking their own session 'completed').
 */
export async function updateScheduleStatusRemote(
  scheduleId: string,
  patch: { status: ClassSession['status']; updatedBy?: string }
) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase
    .from('schedules')
    .update({ status: patch.status, updated_at: new Date().toISOString(), updated_by: patch.updatedBy })
    .eq('id', scheduleId);
  if (error) throw new Error(error.message);
}

export async function upsertAvailabilityRemote(slot: AvailabilitySlot) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('sensei_availability').upsert(availabilityToRow(slot));
  if (error) throw new Error(error.message);
}

export async function upsertSessionLogRemote(log: SessionLog) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('session_logs').upsert({
    id: log.id,
    schedule_id: log.scheduleId,
    sensei_id: log.senseiId,
    clock_in_at: log.clockInAt,
    clock_out_at: log.clockOutAt,
    late_join: log.lateJoin,
    overridden: log.overridden
  });
  if (error) throw new Error(error.message);
}

export async function upsertSessionReportRemote(report: SessionReport) {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase.from('session_reports').upsert({
    id: report.id,
    schedule_id: report.scheduleId,
    submitted_by: report.submittedBy,
    submitted_at: report.submittedAt,
    material_covered: report.materialCovered,
    material_url: report.materialUrl || null,
    level_progress: report.levelProgress,
    session_notes: report.sessionNotes || null,
    recording_url: report.recordingUrl || null,
    recording_status: report.recordingStatus,
    qa_review_status: report.qaReviewStatus,
    qa_reviewer_id: report.qaReviewerId || null,
    qa_reviewed_at: report.qaReviewedAt || null,
    qa_review_notes: report.qaReviewNotes || null
  });
  if (error) throw new Error(error.message);

  await supabase.from('session_student_records').delete().eq('session_report_id', report.id);
  if (report.students.length) {
    const { error: studentError } = await supabase.from('session_student_records').insert(
      report.students.map((item) => ({
        session_report_id: report.id,
        student_id: item.studentId,
        attendance: item.attendance,
        performance_score: item.performanceScore,
        performance_note: item.performanceNote || null
      }))
    );
    if (studentError) throw new Error(studentError.message);
  }
}

export async function upsertQaRemote(score: TeachingQaScore) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('teaching_qa_scores').upsert({
    id: score.id,
    sensei_id: score.senseiId,
    month: score.month,
    score: score.score,
    notes: score.notes || null,
    created_by: score.createdBy,
    created_at: score.createdAt,
    updated_at: score.updatedAt || new Date().toISOString()
  });
  if (error) throw new Error(error.message);
}

export async function upsertSenseiStatusRemote(input: {
  senseiId: string;
  primaryStatus: 'ACTIVE' | 'INACTIVE';
  joinDate?: string;
  leaveStart?: string | null;
  leaveEnd?: string | null;
  updatedBy?: string;
}) {
  const supabase = getSupabase();
  if (!supabase) return;
  // Supabase upsert only writes the columns present in the payload (INSERT ... ON
  // CONFLICT DO UPDATE SET <those columns>). So we deliberately omit leave/join
  // columns unless the caller passes them — a plain status or profile edit must
  // not wipe an approved CUTI period that lives on the same row.
  const row: Record<string, unknown> = {
    sensei_id: input.senseiId,
    primary_status: input.primaryStatus,
    updated_at: new Date().toISOString(),
    updated_by: input.updatedBy || null
  };
  if ('joinDate' in input) {
    row.join_date = input.joinDate || null;
  }
  if ('leaveStart' in input || 'leaveEnd' in input) {
    row.leave_start = input.leaveStart ?? null;
    row.leave_end = input.leaveEnd ?? null;
  }
  const { error } = await supabase.from('sensei_status').upsert(row);
  if (error) throw new Error(error.message);
}

export async function upsertSenseiRemote(sensei: Sensei) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('sensei').upsert(senseiToRow(sensei));
  if (error) throw new Error(error.message);
  await upsertSenseiStatusRemote({
    senseiId: sensei.id,
    primaryStatus: sensei.primaryStatus,
    joinDate: sensei.joinDate
  });
}

export async function upsertSenseiTimezoneRemote(senseiId: string, timezone: SenseiTimezone) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('sensei').update({ timezone }).eq('id', senseiId);
  if (error) throw new Error(error.message);
}

export async function upsertAppSettingsRemote(settings: AppSettings, updatedBy?: string) {
  const supabase = getSupabase();
  if (!supabase) return;
  const now = new Date().toISOString();
  const rows = [
    { key: 'late_grace_minutes', value: settings.lateGraceMinutes },
    { key: 'weekly_hour_target', value: settings.weeklyHourTarget },
    // value is JSONB NOT NULL, so a null threshold is stored as "no row" instead.
    ...(typeof settings.minAttendancePercent === 'number'
      ? [{ key: 'min_attendance_percent', value: settings.minAttendancePercent }]
      : [])
  ].map((row) => ({ ...row, updated_at: now, updated_by: updatedBy || null }));

  const { error } = await supabase.from('app_settings').upsert(rows);
  if (error) throw new Error(error.message);

  if (settings.minAttendancePercent === null) {
    const { error: deleteError } = await supabase
      .from('app_settings')
      .delete()
      .eq('key', 'min_attendance_percent');
    if (deleteError) throw new Error(deleteError.message);
  }
}

export async function upsertLevelCompletionRemote(completion: LevelCompletion) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('level_completions').upsert({
    id: completion.id,
    student_id: completion.studentId,
    level: completion.level,
    next_level: completion.nextLevel,
    completed_at: completion.completedAt,
    completed_by: completion.completedBy,
    notes: completion.notes || null
  });
  if (error) throw new Error(error.message);
}

export async function upsertStudentRemote(student: Student) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('students').upsert(studentToRow(student));
  if (error) throw new Error(error.message);
}

export async function upsertClassMasterRemote(teachingClass: ClassMaster) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('class_masters').upsert(classMasterToRow(teachingClass));
  if (error) throw new Error(error.message);
}

export async function upsertEnrollmentRemote(enrollment: Enrollment) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('enrollments').upsert(enrollmentToRow(enrollment));
  if (error) throw new Error(error.message);
}
