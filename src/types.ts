export type AppRole = 'Super Admin' | 'Kyouiku' | 'Sensei';

export type UserStatus = 'Approved' | 'Pending' | 'Suspended';

export type SenseiPrimaryStatus = 'ACTIVE' | 'INACTIVE';

export type SenseiOperationalLabel = 'NEW' | 'UNASSIGNED' | 'CUTI';

export type ClassType = 'Private' | 'Semi-Private' | 'Group' | 'Kids Private' | 'Kids Semi Private';

export type ClassStatus = 'active' | 'completed' | 'cancelled';

export type ClassMasterStatus = 'draft' | 'ready' | 'active' | 'completed' | 'cancelled';

export type AttendanceStatus = 'Present' | 'Late' | 'Excused' | 'Absent' | 'Partial';

export type RecordingStatus = 'Available' | 'Missing' | 'Not Required';

export type QaReviewStatus = 'Not Reviewed' | 'Reviewed';

export type SessionWorkflowState = 'ready' | 'in_progress' | 'report_pending' | 'completed' | 'cancelled';

export type CancellationInitiator = 'Sensei' | 'Admin' | 'Student' | 'Ops';

export type SwapInitiator = 'Sensei' | 'Admin' | 'Student';

export type AvailabilityPattern = 'specific_date' | 'weekly';

export type TabId =
  | 'overview'
  | 'classes'
  | 'schedule'
  | 'availability'
  | 'teaching'
  | 'sensei'
  | 'students'
  | 'qa'
  | 'disciplinary'
  | 'audit'
  | 'users'
  | 'settings'
  | 'reports';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  status: UserStatus;
  senseiId?: string;
}

export type SenseiTimezone = 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura' | 'Asia/Tokyo';

export interface Sensei {
  id: string;
  name: string;
  displayName?: string;
  email: string;
  phone: string;
  levels: string[];
  primaryStatus: SenseiPrimaryStatus;
  joinDate: string;
  timezone: SenseiTimezone;
  notes?: string;
}

export interface LeavePeriod {
  id: string;
  senseiId: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'approved' | 'pending' | 'rejected';
}

export interface Student {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  type: ClassType;
  currentLevel: string;
  startingLevel: string;
  senseiId?: string;
  isActive: boolean;
  academicNotes?: string;
}

export interface LevelCompletion {
  id: string;
  studentId: string;
  level: string;
  nextLevel: string | null;
  completedAt: string;
  completedBy: string;
  notes?: string;
}

export type EnrollmentStatus =
  'active' | 'ending_soon' | 'completed' | 'stopped' | 'transferred' | 'cancelled';

export type PaymentStatus = 'LUNAS' | 'CICILAN' | 'BELUM_BAYAR';

export interface Enrollment {
  id: string;
  studentId: string;
  level: string;
  classType?: ClassType | null;
  classId?: string | null;
  senseiId?: string | null;
  status: EnrollmentStatus;
  startDate?: string | null;
  endDate?: string | null;
  plannedEndDate?: string | null;
  requiredMeetings?: number | null;
  sessionsCompleted?: number | null;
  paymentStatus?: PaymentStatus | null;
  paymentRemark?: string;
  enrollmentRemark?: string;
  notes?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Group {
  id: string;
  name: string;
  studentIds: string[];
  level: string;
}

export interface ClassMaster {
  id: string;
  displayName: string;
  code?: string | null;
  type: ClassType;
  level: string;
  senseiId: string;
  studentIds: string[];
  requiredMeetings: number;
  sessionDurationMinutes: number;
  startDate?: string | null;
  plannedEndDate?: string | null;
  /** Latest projected end from calendar; never overwrites plannedEndDate. */
  projectedEndDate?: string | null;
  meetLink?: string | null;
  classroomLink?: string | null;
  chatLink?: string | null;
  materialLink?: string | null;
  teachingNotes?: string | null;
  status: ClassMasterStatus;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AvailabilitySlot {
  id: string;
  senseiId: string;
  pattern: AvailabilityPattern;
  date?: string | null;
  weekday?: number | null;
  startTime: string;
  endTime: string;
  remarks?: string;
  isActive: boolean;
}

export interface ClassSession {
  id: string;
  classId?: string | null;
  senseiId: string;
  studentIds: string[];
  groupId?: string | null;
  type: ClassType;
  level: string;
  date: string;
  startTime: string;
  endTime: string;
  status: ClassStatus;
  makeupOfSessionId?: string | null;
  /** Extra meeting beyond original required plan (not a makeup). */
  isExtra?: boolean;
  cancellationReason?: string | null;
  cancellationInitiator?: CancellationInitiator | null;
  replacementSecured?: boolean | null;
  originalSenseiId?: string | null;
  swapInitiator?: SwapInitiator | null;
  swapReason?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SessionLog {
  id: string;
  scheduleId: string;
  senseiId: string;
  clockInAt?: string | null;
  clockOutAt?: string | null;
  lateJoin: boolean;
  overridden: boolean;
}

export interface StudentSessionRecord {
  studentId: string;
  attendance: AttendanceStatus;
  performanceScore?: number | null;
  performanceNote?: string;
}

export interface SessionReport {
  id: string;
  scheduleId: string;
  submittedBy: string;
  submittedAt: string;
  students: StudentSessionRecord[];
  materialCovered: string;
  materialUrl?: string;
  levelProgress: string;
  sessionNotes?: string;
  recordingUrl?: string;
  recordingStatus: RecordingStatus;
  qaReviewStatus: QaReviewStatus;
  qaReviewerId?: string | null;
  qaReviewedAt?: string | null;
  qaReviewNotes?: string;
}

export interface TeachingQaScore {
  id: string;
  senseiId: string;
  month: string;
  score: number;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entity: string;
  recordId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  createdAt: string;
}

export interface AppSettings {
  lateGraceMinutes: number;
  minAttendancePercent: number | null;
  weeklyHourTarget: number;
}

export interface DashboardSnapshot {
  users: UserAccount[];
  sensei: Sensei[];
  students: Student[];
  groups: Group[];
  classMasters: ClassMaster[];
  availability: AvailabilitySlot[];
  schedules: ClassSession[];
  sessionLogs: SessionLog[];
  sessionReports: SessionReport[];
  qaScores: TeachingQaScore[];
  leavePeriods: LeavePeriod[];
  auditLogs: AuditLog[];
  levelCompletions: LevelCompletion[];
  enrollments: Enrollment[];
  settings: AppSettings;
}

export interface Permissions {
  role: AppRole;
  canViewAllSchedules: boolean;
  canEditOfficialSchedule: boolean;
  canAssignSensei: boolean;
  canMarkOwnAvailability: boolean;
  canOverrideAvailability: boolean;
  canClockOwn: boolean;
  canOverrideClock: boolean;
  canInputAttendance: boolean;
  canOverrideAcademic: boolean;
  canReviewQa: boolean;
  canEditQa: boolean;
  canViewOwnQa: boolean;
  canManageUsers: boolean;
  /** Super Admin + Kyouiku: change operational settings (Pengaturan), incl. the weekly hour target. Never Sensei. */
  canManageSettings: boolean;
  canViewAudit: boolean;
  canViewAllSensei: boolean;
  /** Super Admin/Ops: export all Sensei EOM. Sensei: view own only (no export). */
  canExportEomReport: boolean;
}

export interface WorkloadMetrics {
  senseiId: string;
  availableHours: number;
  assignedHours: number;
  remainingHours: number;
  utilization: number | null;
  targetHours: number;
  targetGap: number;
  targetProgress: number;
}

export interface ActionItem {
  id: string;
  kind:
    | 'missing_report'
    | 'missing_recording'
    | 'late_join'
    | 'schedule_conflict'
    | 'unassigned_sensei'
    | 'hours_below_target'
    | 'low_availability'
    | 'ending_soon'
    | 'overdue_class';
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  senseiId?: string;
  scheduleId?: string;
  classId?: string;
  studentId?: string;
  enrollmentId?: string;
}

export interface DisciplinaryMetrics {
  senseiId: string;
  month: string;
  senseiInitiatedSwaps: number;
  cancelledNoReplacement: number;
  lateJoins: number;
}
