import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from 'sonner';
import { WEEKLY_HOUR_TARGET } from '../constants';
import { getPermissions } from '../lib/rbac';
import { wouldConflict } from '../lib/schedule';
import { isLateJoin } from '../lib/session';
import { isUuid, resolveSenseiId } from '../lib/senseiLink';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';
import { mapProfile } from '../lib/mappers';
import { hasActiveOrCompletedMakeup } from '../lib/makeup';
import { createAuthLogin } from '../lib/createAuthLogin';
import { classCompositionError } from '../lib/classComposition';
import { computeProjectedEndDate } from '../lib/classProgress';
import { addMinutesToTime, generateRecurringDates, suggestPlannedEndDate } from '../lib/recurring';
import { previewConflicts, buildRecurringPreview } from '../lib/schedulePreview';
import {
  ensureProfile,
  loadDashboardSnapshot,
  upsertAppSettingsRemote,
  upsertAvailabilityRemote,
  upsertClassMasterRemote,
  upsertLevelCompletionRemote,
  upsertQaRemote,
  upsertScheduleRemote,
  updateScheduleStatusRemote,
  upsertSenseiStatusRemote,
  upsertSenseiTimezoneRemote,
  upsertSenseiRemote,
  upsertSessionLogRemote,
  upsertEnrollmentRemote,
  upsertSessionReportRemote,
  upsertStudentRemote,
  updateProfileRemote,
  deleteProfileRemote,
  deleteSenseiRemote,
  deleteStudentRemote,
  deleteClassMasterRemote,
  writeAudit
} from '../services/supabaseData';
import { ensureClassEnrollments, progressEnrollmentJourney } from '../lib/enrollment';
import type {
  AppRole,
  AppSettings,
  AttendanceStatus,
  AvailabilitySlot,
  CancellationInitiator,
  ClassMaster,
  ClassSession,
  DashboardSnapshot,
  Enrollment,
  LevelCompletion,
  Permissions,
  RecordingStatus,
  Sensei,
  SenseiTimezone,
  SessionReport,
  Student,
  StudentSessionRecord,
  SwapInitiator,
  TabId,
  TeachingQaScore,
  UserAccount,
  UserStatus
} from '../types';

function createId() {
  return crypto.randomUUID();
}

function emptySnapshot(): DashboardSnapshot {
  return {
    users: [],
    sensei: [],
    students: [],
    groups: [],
    classMasters: [],
    availability: [],
    schedules: [],
    sessionLogs: [],
    sessionReports: [],
    qaScores: [],
    leavePeriods: [],
    auditLogs: [],
    levelCompletions: [],
    enrollments: [],
    settings: {
      lateGraceMinutes: 0,
      minAttendancePercent: null,
      weeklyHourTarget: WEEKLY_HOUR_TARGET
    }
  };
}

async function safeRemote(task: () => Promise<void>, label: string) {
  if (!isSupabaseConfigured()) return;
  try {
    await task();
  } catch (error) {
    console.error(error);
    toast.error(`${label}: ${error instanceof Error ? error.message : 'gagal menyimpan'}`);
  }
}

interface ClassInput {
  senseiId: string;
  studentIds: string[];
  groupId?: string | null;
  classId?: string | null;
  type: ClassSession['type'];
  level: string;
  date: string;
  startTime: string;
  endTime: string;
  makeupOfSessionId?: string | null;
  isExtra?: boolean;
}

interface RecurringOfficialInput {
  displayName: string;
  senseiId: string;
  studentIds: string[];
  type: ClassSession['type'];
  level: string;
  startDate: string;
  weekdays: number[];
  startTime: string;
  durationMinutes: number;
  requiredMeetings: number;
  acknowledgeConflicts?: boolean;
}

interface DashboardStore extends DashboardSnapshot {
  currentUser: UserAccount | null;
  activeTab: TabId;
  weekAnchor: string;
  dataSource: 'supabase' | 'unconfigured';
  isBootstrapping: boolean;
  signInWithEmail: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  hydrateFromSupabase: () => Promise<void>;
  bootstrapAuth: () => Promise<void>;
  setTab: (tab: TabId) => void;
  setWeekAnchor: (date: string) => void;
  upsertAvailability: (slot: Omit<AvailabilitySlot, 'id'> & { id?: string }) => void;
  removeAvailability: (id: string) => void;
  createClass: (input: ClassInput, reason?: string) => boolean;
  createRecurringOfficialClass: (input: RecurringOfficialInput) => boolean;
  createExtraSession: (input: ClassInput & { classId: string }, reason?: string) => boolean;
  updateClass: (id: string, input: Partial<ClassInput>, reason: string) => boolean;
  cancelClass: (
    id: string,
    payload: { reason: string; initiator: CancellationInitiator; replacementSecured: boolean }
  ) => void;
  swapSensei: (id: string, newSenseiId: string, initiator: SwapInitiator, reason: string) => boolean;
  clockIn: (scheduleId: string, at?: string) => void;
  clockOut: (scheduleId: string, at?: string) => void;
  overrideClock: (scheduleId: string, clockInAt: string, clockOutAt: string | null, reason: string) => void;
  submitSessionReport: (
    scheduleId: string,
    payload: {
      students: StudentSessionRecord[];
      materialCovered: string;
      materialUrl?: string;
      levelProgress: string;
      sessionNotes?: string;
      recordingUrl?: string;
      recordingStatus: RecordingStatus;
    }
  ) => void;
  overrideAttendance: (
    reportId: string,
    studentId: string,
    attendance: AttendanceStatus,
    reason: string
  ) => void;
  overridePerformance: (reportId: string, studentId: string, score: number, reason: string) => void;
  reviewRecording: (reportId: string, notes: string) => void;
  upsertQaScore: (senseiId: string, month: string, score: number, notes: string) => void;
  overrideSenseiStatus: (senseiId: string, status: 'ACTIVE' | 'INACTIVE', reason: string) => void;
  updateSenseiTimezone: (senseiId: string, timezone: SenseiTimezone) => void;
  upsertSensei: (input: Omit<Sensei, 'id'> & { id?: string }) => string | null;
  setSenseiLeave: (
    senseiId: string,
    leave: { startDate: string; endDate: string } | null,
    reason: string
  ) => boolean;
  upsertStudent: (input: Omit<Student, 'id'> & { id?: string }) => string | null;
  upsertEnrollment: (
    input: Omit<Enrollment, 'id' | 'updatedAt' | 'updatedBy'> & { id?: string }
  ) => string | null;
  updateSettings: (patch: Partial<AppSettings>) => void;
  completeLevel: (input: {
    studentId: string;
    level: string;
    nextLevel: string | null;
    notes?: string;
  }) => boolean;
  upsertClassMaster: (input: Omit<ClassMaster, 'id'> & { id?: string }) => string | null;
  generateClassSchedule: (input: {
    classId: string;
    startDate: string;
    weekdays: number[];
    startTime: string;
    meetings?: number;
  }) => number;
  /** Create Supabase Auth login + profile (Admin stays signed in). */
  createUserLogin: (input: {
    email: string;
    password: string;
    role: AppRole;
    status?: UserStatus;
    name?: string;
    senseiId?: string;
  }) => Promise<boolean>;
  upsertUser: (user: Omit<UserAccount, 'id'> & { id?: string }) => void;
  updateUser: (
    userId: string,
    patch: { role?: AppRole; status?: UserStatus; senseiId?: string | null }
  ) => Promise<boolean>;
  deleteUser: (userId: string) => Promise<boolean>;
  deleteSensei: (senseiId: string) => Promise<boolean>;
  deleteStudent: (studentId: string) => Promise<boolean>;
  deleteClassMaster: (classId: string) => Promise<boolean>;
}

function actor(state: DashboardStore) {
  return {
    actorId: state.currentUser?.id ?? 'system',
    actorName: state.currentUser?.name ?? 'System'
  };
}

/** Patch ClassMaster projectedEndDate from calendar without touching plannedEndDate. */
function withRefreshedProjectedEnd(
  teachingClass: ClassMaster,
  schedules: ClassSession[],
  actorName?: string
): ClassMaster {
  const projected = computeProjectedEndDate(teachingClass.id, schedules);
  if ((teachingClass.projectedEndDate || null) === (projected || null)) return teachingClass;
  return {
    ...teachingClass,
    projectedEndDate: projected,
    updatedAt: new Date().toISOString(),
    updatedBy: actorName
  };
}

function pushAudit(
  state: DashboardStore,
  entry: {
    action: string;
    entity: string;
    recordId: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
  }
) {
  const who = actor(state);
  state.auditLogs = [
    {
      id: createId(),
      ...who,
      ...entry,
      createdAt: new Date().toISOString()
    },
    ...state.auditLogs
  ];
  void safeRemote(
    () =>
      writeAudit({
        actorId: who.actorId,
        actorEmail: state.currentUser?.email,
        action: entry.action,
        entity: entry.entity,
        recordId: entry.recordId,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        reason: entry.reason
      }),
    'Audit log'
  );
}

export const useDashboardStore = create<DashboardStore>()(
  persist(
    (set, get) => ({
      ...emptySnapshot(),
      currentUser: null,
      activeTab: 'overview',
      weekAnchor: new Date().toISOString().slice(0, 10),
      dataSource: isSupabaseConfigured() ? 'supabase' : 'unconfigured',
      isBootstrapping: Boolean(isSupabaseConfigured()),
      signInWithEmail: async (email, password) => {
        const supabase = getSupabase();
        if (!supabase) {
          toast.error('Layanan autentikasi belum dikonfigurasi');
          return false;
        }
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error || !data.user) {
          toast.error(error?.message || 'Login gagal');
          return false;
        }
        const profile = await ensureProfile(data.user.id, data.user.email || email);
        await get().hydrateFromSupabase();
        const linkedSenseiId = resolveSenseiId(get().sensei, {
          senseiId: profile?.sensei_id ? String(profile.sensei_id) : null,
          email: data.user.email || email
        });
        const linkedSensei = get().sensei.find((item) => item.id === linkedSenseiId);
        const account: UserAccount = {
          ...mapProfile(profile || {}, linkedSenseiId),
          name: linkedSensei?.name || (data.user.email || email).split('@')[0]
        };
        if (account.role === 'Sensei' && !linkedSenseiId) {
          toast.error(
            'Akun Sensei belum tertaut. Samakan email Auth dengan email di tabel sensei, atau set profiles.sensei_id.'
          );
        }
        if (account.status !== 'Approved') {
          await supabase.auth.signOut();
          set({ currentUser: null });
          toast.error('Akun masih Pending. Minta Super Admin approve dulu.');
          return false;
        }
        set({ currentUser: account, activeTab: 'overview', dataSource: 'supabase' });
        toast.success(`Masuk sebagai ${account.role}`);
        return true;
      },
      logout: async () => {
        const supabase = getSupabase();
        if (supabase) await supabase.auth.signOut();
        set({ currentUser: null });
      },
      hydrateFromSupabase: async () => {
        if (!isSupabaseConfigured()) {
          set({ ...emptySnapshot(), dataSource: 'unconfigured', isBootstrapping: false, currentUser: null });
          return;
        }
        set({ isBootstrapping: true });
        try {
          const snapshot = await loadDashboardSnapshot();
          if (!snapshot) {
            set({ dataSource: 'unconfigured', isBootstrapping: false });
            toast.error('Gagal memuat data dashboard');
            return;
          }
          set({
            ...snapshot,
            dataSource: 'supabase',
            isBootstrapping: false
          });
        } catch (error) {
          console.error(error);
          toast.error(error instanceof Error ? error.message : 'Gagal memuat data dashboard');
          set({ isBootstrapping: false });
        }
      },
      bootstrapAuth: async () => {
        const supabase = getSupabase();
        if (!supabase) {
          set({ ...emptySnapshot(), dataSource: 'unconfigured', isBootstrapping: false, currentUser: null });
          return;
        }
        set({ isBootstrapping: true, dataSource: 'supabase' });
        const { data } = await supabase.auth.getSession();
        await get().hydrateFromSupabase();
        if (!data.session?.user) {
          set({ currentUser: null, isBootstrapping: false });
          return;
        }
        try {
          const profile = await ensureProfile(data.session.user.id, data.session.user.email || '');
          const linkedSenseiId = resolveSenseiId(get().sensei, {
            senseiId: profile?.sensei_id ? String(profile.sensei_id) : null,
            email: data.session.user.email || ''
          });
          const linkedSensei = get().sensei.find((item) => item.id === linkedSenseiId);
          const account: UserAccount = {
            ...mapProfile(profile || {}, linkedSenseiId),
            name: linkedSensei?.name || (data.session.user.email || '').split('@')[0]
          };
          set({
            currentUser: account.status === 'Approved' ? account : null,
            isBootstrapping: false
          });
          if (account.status === 'Approved' && account.role === 'Sensei' && !linkedSenseiId) {
            toast.error(
              'Akun Sensei belum tertaut. Samakan email Auth dengan email di tabel sensei, atau set profiles.sensei_id.'
            );
          }
        } catch (error) {
          console.error(error);
          set({ currentUser: null, isBootstrapping: false });
        }
      },
      setTab: (tab) => set({ activeTab: tab }),
      setWeekAnchor: (date) => set({ weekAnchor: date }),
      upsertAvailability: (slot) => {
        const state = get();
        const resolvedSenseiId =
          resolveSenseiId(state.sensei, {
            senseiId: slot.senseiId,
            email: state.currentUser?.email
          }) || slot.senseiId;

        if (!isUuid(resolvedSenseiId)) {
          toast.error(
            'Sensei belum tertaut ke master data. Samakan email login dengan kolom email di tabel sensei.'
          );
          return;
        }

        const id = slot.id && isUuid(slot.id) ? slot.id : createId();
        const next = {
          ...slot,
          id,
          senseiId: resolvedSenseiId,
          date: slot.pattern === 'specific_date' ? slot.date || null : null,
          weekday: slot.pattern === 'weekly' ? (slot.weekday ?? null) : null
        };
        set((current) => {
          const exists = current.availability.some((item) => item.id === id);
          const currentUser =
            current.currentUser && !current.currentUser.senseiId
              ? { ...current.currentUser, senseiId: resolvedSenseiId }
              : current.currentUser;
          return {
            currentUser,
            availability: exists
              ? current.availability.map((item) => (item.id === id ? next : item))
              : [next, ...current.availability]
          };
        });
        void safeRemote(() => upsertAvailabilityRemote(next), 'Simpan ketersediaan');
        toast.success('Ketersediaan Sensei disimpan. Jadwal resmi tidak berubah.');
      },
      removeAvailability: (id) => {
        let nextSlot: AvailabilitySlot | undefined;
        set((state) => {
          nextSlot = state.availability.find((item) => item.id === id);
          return {
            availability: state.availability.map((item) =>
              item.id === id ? { ...item, isActive: false } : item
            )
          };
        });
        if (nextSlot) {
          void safeRemote(
            () => upsertAvailabilityRemote({ ...nextSlot!, isActive: false }),
            'Nonaktifkan ketersediaan'
          );
        }
        toast.success('Slot ketersediaan dinonaktifkan');
      },
      createClass: (input, reason) => {
        const state = get();
        const compositionError = classCompositionError(input.type, input.studentIds);
        if (compositionError) {
          toast.error(compositionError);
          return false;
        }
        if (input.makeupOfSessionId) {
          const original = state.schedules.find((item) => item.id === input.makeupOfSessionId);
          if (!original) {
            toast.error('Sesi asli untuk makeup tidak ditemukan');
            return false;
          }
          if (original.status !== 'cancelled') {
            toast.error('Makeup hanya untuk kelas yang sudah dibatalkan');
            return false;
          }
          if (hasActiveOrCompletedMakeup(original.id, state.schedules)) {
            toast.error('Kelas ini sudah punya makeup aktif');
            return false;
          }
        }
        const session: ClassSession = {
          id: createId(),
          ...input,
          classId: input.classId ?? null,
          makeupOfSessionId: input.makeupOfSessionId ?? null,
          isExtra: Boolean(input.isExtra),
          status: 'active',
          updatedAt: new Date().toISOString(),
          updatedBy: state.currentUser?.name
        };
        if (wouldConflict(state.schedules, session)) {
          toast.error('Bentrok dengan kelas Sensei yang sama. Selesaikan konflik dulu.');
          return false;
        }
        let patchedOriginal: ClassSession | undefined;
        let patchedClass: ClassMaster | undefined;
        set((current) => {
          pushAudit(current, {
            action: input.makeupOfSessionId
              ? 'create_makeup_class'
              : input.isExtra
                ? 'create_extra_meeting'
                : 'create_class',
            entity: 'schedules',
            recordId: session.id,
            newValue: session,
            reason
          });
          let schedules = [session, ...current.schedules];
          if (input.makeupOfSessionId) {
            schedules = schedules.map((item) => {
              if (item.id !== input.makeupOfSessionId) return item;
              patchedOriginal = {
                ...item,
                replacementSecured: true,
                updatedAt: new Date().toISOString(),
                updatedBy: current.currentUser?.name
              };
              return patchedOriginal;
            });
          }
          let classMasters = current.classMasters;
          if (session.classId) {
            classMasters = current.classMasters.map((item) => {
              if (item.id !== session.classId) return item;
              patchedClass = withRefreshedProjectedEnd(item, schedules, current.currentUser?.name);
              return patchedClass;
            });
          }
          current.schedules = schedules;
          current.classMasters = classMasters;
          return { schedules, classMasters, auditLogs: current.auditLogs };
        });
        void safeRemote(
          async () => {
            await upsertScheduleRemote(session);
            if (patchedOriginal) await upsertScheduleRemote(patchedOriginal);
            if (patchedClass) await upsertClassMasterRemote(patchedClass);
          },
          input.makeupOfSessionId ? 'Simpan makeup' : input.isExtra ? 'Simpan extra meeting' : 'Simpan kelas'
        );
        toast.success(
          input.makeupOfSessionId
            ? 'Makeup class ditambahkan dan tertaut ke sesi asli'
            : input.isExtra
              ? 'Extra meeting ditambahkan (tidak mengubah required meetings)'
              : 'Kelas resmi ditambahkan'
        );
        return true;
      },
      createRecurringOfficialClass: (input) => {
        const state = get();
        if (!input.displayName.trim()) {
          toast.error('Nama kelas wajib diisi');
          return false;
        }
        if (!input.senseiId || input.studentIds.length === 0) {
          toast.error('Sensei dan minimal 1 siswa wajib');
          return false;
        }
        const recurringCompositionError = classCompositionError(input.type, input.studentIds);
        if (recurringCompositionError) {
          toast.error(recurringCompositionError);
          return false;
        }
        if (input.weekdays.length === 0) {
          toast.error('Pilih minimal 1 hari berulang');
          return false;
        }
        const requiredMeetings = Math.max(1, input.requiredMeetings || 1);
        const durationMinutes = Math.max(30, input.durationMinutes || 90);
        const preview = buildRecurringPreview({
          startDate: input.startDate,
          weekdays: input.weekdays,
          startTime: input.startTime,
          durationMinutes,
          requiredMeetings
        });
        if (!preview.length) {
          toast.error('Tidak ada tanggal yang bisa digenerate');
          return false;
        }
        const conflicts = previewConflicts(
          state.schedules,
          preview,
          input.senseiId,
          input.studentIds,
          input.type,
          input.level
        );
        if (conflicts.length > 0 && !input.acknowledgeConflicts) {
          toast.error(
            `${conflicts.length} konflik dengan jadwal resmi. Tinjau preview lalu centang konfirmasi sebelum simpan.`
          );
          return false;
        }
        const classId = createId();
        const plannedEnd = preview[preview.length - 1]!.date;
        const teachingClass: ClassMaster = {
          id: classId,
          displayName: input.displayName.trim(),
          type: input.type,
          level: input.level,
          senseiId: input.senseiId,
          studentIds: input.studentIds,
          requiredMeetings,
          sessionDurationMinutes: durationMinutes,
          startDate: input.startDate,
          plannedEndDate: plannedEnd,
          projectedEndDate: plannedEnd,
          status: 'ready',
          updatedAt: new Date().toISOString(),
          updatedBy: state.currentUser?.name
        };
        const created: ClassSession[] = preview.map((row) => ({
          id: createId(),
          classId,
          senseiId: input.senseiId,
          studentIds: input.studentIds,
          type: input.type,
          level: input.level,
          date: row.date,
          startTime: row.startTime,
          endTime: row.endTime,
          status: 'active',
          updatedAt: new Date().toISOString(),
          updatedBy: state.currentUser?.name
        }));
        const ensured = ensureClassEnrollments({
          enrollments: state.enrollments,
          teachingClass,
          createId,
          actorName: state.currentUser?.name
        });
        set((current) => {
          pushAudit(current, {
            action: 'bulk_schedule_generated',
            entity: 'class_masters',
            recordId: classId,
            newValue: {
              class: teachingClass,
              sessions: created.length,
              requiredMeetings,
              weekdays: input.weekdays,
              conflictsAcknowledged: Boolean(input.acknowledgeConflicts),
              conflictCount: conflicts.length,
              enrollmentIds: ensured.changed.map((item) => item.id)
            }
          });
          return {
            classMasters: [teachingClass, ...current.classMasters],
            schedules: [...created, ...current.schedules],
            enrollments: ensured.enrollments,
            auditLogs: current.auditLogs
          };
        });
        void safeRemote(async () => {
          await upsertClassMasterRemote(teachingClass);
          for (const enrollment of ensured.changed) await upsertEnrollmentRemote(enrollment);
          for (const session of created) await upsertScheduleRemote(session);
        }, 'Simpan kelas & jadwal berulang');
        toast.success(`1 kelas + ${created.length} sesi disimpan (${preview[0]?.date} → ${plannedEnd})`);
        return true;
      },
      createExtraSession: (input, reason) => {
        return get().createClass(
          { ...input, isExtra: true, makeupOfSessionId: null },
          reason || 'Extra meeting di luar rencana required meetings'
        );
      },
      updateClass: (id, input, reason) => {
        const state = get();
        const existing = state.schedules.find((item) => item.id === id);
        if (!existing) return false;
        const next = {
          ...existing,
          ...input,
          updatedAt: new Date().toISOString(),
          updatedBy: state.currentUser?.name
        };
        const editCompositionError = classCompositionError(next.type, next.studentIds);
        if (editCompositionError) {
          toast.error(editCompositionError);
          return false;
        }
        if (wouldConflict(state.schedules, next)) {
          toast.error('Perubahan menyebabkan konflik jadwal');
          return false;
        }
        let patchedClass: ClassMaster | undefined;
        set((current) => {
          pushAudit(current, {
            action: 'edit_class',
            entity: 'schedules',
            recordId: id,
            oldValue: existing,
            newValue: next,
            reason
          });
          const schedules = current.schedules.map((item) => (item.id === id ? next : item));
          let classMasters = current.classMasters;
          const classId = next.classId;
          if (classId) {
            classMasters = current.classMasters.map((item) => {
              if (item.id !== classId) return item;
              patchedClass = withRefreshedProjectedEnd(item, schedules, current.currentUser?.name);
              return patchedClass;
            });
          }
          return {
            schedules,
            classMasters,
            auditLogs: current.auditLogs
          };
        });
        void safeRemote(async () => {
          await upsertScheduleRemote(next);
          if (patchedClass) await upsertClassMasterRemote(patchedClass);
        }, 'Update kelas');
        toast.success('Jadwal resmi diperbarui');
        return true;
      },
      cancelClass: (id, payload) => {
        let nextSession: ClassSession | undefined;
        let patchedClass: ClassMaster | undefined;
        set((state) => {
          const existing = state.schedules.find((item) => item.id === id);
          if (!existing) return state;
          nextSession = {
            ...existing,
            status: 'cancelled',
            cancellationReason: payload.reason,
            cancellationInitiator: payload.initiator,
            replacementSecured: payload.replacementSecured,
            originalSenseiId: existing.originalSenseiId ?? existing.senseiId,
            updatedAt: new Date().toISOString(),
            updatedBy: state.currentUser?.name
          };
          pushAudit(state, {
            action: 'cancel_class',
            entity: 'schedules',
            recordId: id,
            oldValue: existing,
            newValue: nextSession,
            reason: payload.reason
          });
          const schedules = state.schedules.map((item) => (item.id === id ? nextSession! : item));
          let classMasters = state.classMasters;
          if (existing.classId) {
            classMasters = state.classMasters.map((item) => {
              if (item.id !== existing.classId) return item;
              patchedClass = withRefreshedProjectedEnd(item, schedules, state.currentUser?.name);
              return patchedClass;
            });
          }
          return {
            schedules,
            classMasters,
            auditLogs: state.auditLogs
          };
        });
        if (nextSession) {
          void safeRemote(async () => {
            await upsertScheduleRemote(nextSession!);
            if (patchedClass) await upsertClassMasterRemote(patchedClass);
          }, 'Batalkan kelas');
        }
        toast.success('Kelas dibatalkan dan tercatat di audit log');
      },
      swapSensei: (id, newSenseiId, initiator, reason) => {
        const state = get();
        const existing = state.schedules.find((item) => item.id === id);
        if (!existing) return false;
        const next: ClassSession = {
          ...existing,
          originalSenseiId: existing.originalSenseiId ?? existing.senseiId,
          senseiId: newSenseiId,
          swapInitiator: initiator,
          swapReason: reason,
          updatedAt: new Date().toISOString(),
          updatedBy: state.currentUser?.name
        };
        if (wouldConflict(state.schedules, next)) {
          toast.error('Sensei pengganti sudah punya kelas di jam ini');
          return false;
        }
        set((current) => {
          pushAudit(current, {
            action: 'swap_sensei',
            entity: 'schedules',
            recordId: id,
            oldValue: { senseiId: existing.senseiId },
            newValue: { senseiId: newSenseiId, swapInitiator: initiator },
            reason
          });
          return {
            schedules: current.schedules.map((item) => (item.id === id ? next : item)),
            auditLogs: current.auditLogs
          };
        });
        void safeRemote(() => upsertScheduleRemote(next), 'Swap Sensei');
        toast.success('Sensei diganti. Atribusi initiator tersimpan.');
        return true;
      },
      clockIn: (scheduleId, at) => {
        const state = get();
        const session = state.schedules.find((item) => item.id === scheduleId);
        if (!session) return;
        const teachingSensei = state.sensei.find((item) => item.id === session.senseiId);
        const clockInAt = at ?? new Date().toISOString();
        const lateJoin = isLateJoin(
          session,
          clockInAt,
          state.settings.lateGraceMinutes,
          teachingSensei?.timezone
        );
        let savedLog = null as ReturnType<typeof get>['sessionLogs'][number] | null;
        set((current) => {
          const existing = current.sessionLogs.find((item) => item.scheduleId === scheduleId);
          const log = {
            id: existing?.id ?? createId(),
            scheduleId,
            senseiId: session.senseiId,
            clockInAt,
            clockOutAt: existing?.clockOutAt ?? null,
            lateJoin,
            overridden: false
          };
          savedLog = log;
          return {
            sessionLogs: existing
              ? current.sessionLogs.map((item) => (item.scheduleId === scheduleId ? log : item))
              : [log, ...current.sessionLogs]
          };
        });
        if (savedLog) void safeRemote(() => upsertSessionLogRemote(savedLog!), 'Clock-in');
        toast.success(lateJoin ? 'Clock-in tercatat (terlambat)' : 'Clock-in tercatat');
      },
      clockOut: (scheduleId, at) => {
        let savedLog = null as ReturnType<typeof get>['sessionLogs'][number] | null;
        set((state) => {
          const nextLogs = state.sessionLogs.map((item) =>
            item.scheduleId === scheduleId ? { ...item, clockOutAt: at ?? new Date().toISOString() } : item
          );
          savedLog = nextLogs.find((item) => item.scheduleId === scheduleId) || null;
          return { sessionLogs: nextLogs };
        });
        if (savedLog) void safeRemote(() => upsertSessionLogRemote(savedLog!), 'Clock-out');
        toast.success('Clock-out tercatat. Lanjut isi laporan sesi.');
      },
      overrideClock: (scheduleId, clockInAt, clockOutAt, reason) => {
        const state = get();
        const session = state.schedules.find((item) => item.id === scheduleId);
        if (!session) return;
        const teachingSensei = state.sensei.find((item) => item.id === session.senseiId);
        let savedLog = null as ReturnType<typeof get>['sessionLogs'][number] | null;
        set((current) => {
          const existing = current.sessionLogs.find((item) => item.scheduleId === scheduleId);
          const log = {
            id: existing?.id ?? createId(),
            scheduleId,
            senseiId: session.senseiId,
            clockInAt,
            clockOutAt,
            lateJoin: isLateJoin(
              session,
              clockInAt,
              current.settings.lateGraceMinutes,
              teachingSensei?.timezone
            ),
            overridden: true
          };
          savedLog = log;
          pushAudit(current, {
            action: 'override_clock',
            entity: 'session_logs',
            recordId: log.id,
            oldValue: existing,
            newValue: log,
            reason
          });
          return {
            sessionLogs: existing
              ? current.sessionLogs.map((item) => (item.scheduleId === scheduleId ? log : item))
              : [log, ...current.sessionLogs],
            auditLogs: current.auditLogs
          };
        });
        if (savedLog) void safeRemote(() => upsertSessionLogRemote(savedLog!), 'Override clock');
        toast.success('Clock-in/out di-override dengan audit');
      },
      submitSessionReport: (scheduleId, payload) => {
        const state = get();
        let savedReport: SessionReport | null = null;
        let completedSession: ClassSession | undefined;
        set((current) => {
          const existing = current.sessionReports.find((item) => item.scheduleId === scheduleId);
          const report: SessionReport = {
            id: existing?.id ?? createId(),
            scheduleId,
            submittedBy: state.currentUser?.id ?? 'unknown',
            submittedAt: new Date().toISOString(),
            qaReviewStatus: existing?.qaReviewStatus ?? 'Not Reviewed',
            qaReviewerId: existing?.qaReviewerId,
            qaReviewedAt: existing?.qaReviewedAt,
            qaReviewNotes: existing?.qaReviewNotes,
            ...payload
          };
          savedReport = report;
          const schedules = current.schedules.map((item) => {
            if (item.id === scheduleId && item.status === 'active') {
              completedSession = {
                ...item,
                status: 'completed' as const,
                updatedAt: new Date().toISOString(),
                updatedBy: state.currentUser?.name
              };
              return completedSession;
            }
            return item;
          });
          return {
            sessionReports: existing
              ? current.sessionReports.map((item) => (item.scheduleId === scheduleId ? report : item))
              : [report, ...current.sessionReports],
            schedules
          };
        });
        if (savedReport) {
          void safeRemote(async () => {
            await upsertSessionReportRemote(savedReport!);
            if (completedSession) {
              await updateScheduleStatusRemote(completedSession.id, {
                status: 'completed',
                updatedBy: completedSession.updatedBy
              });
            }
          }, 'Simpan laporan');
        }
        toast.success('Laporan sesi tersimpan per siswa');
      },
      overrideAttendance: (reportId, studentId, attendance, reason) => {
        let nextReport: SessionReport | null = null;
        set((state) => {
          const report = state.sessionReports.find((item) => item.id === reportId);
          if (!report) return state;
          const old = report.students.find((item) => item.studentId === studentId);
          nextReport = {
            ...report,
            students: report.students.map((item) =>
              item.studentId === studentId ? { ...item, attendance } : item
            )
          };
          pushAudit(state, {
            action: 'override_attendance',
            entity: 'session_reports',
            recordId: reportId,
            oldValue: old?.attendance,
            newValue: attendance,
            reason
          });
          return {
            sessionReports: state.sessionReports.map((item) => (item.id === reportId ? nextReport! : item)),
            auditLogs: state.auditLogs
          };
        });
        if (nextReport) void safeRemote(() => upsertSessionReportRemote(nextReport!), 'Koreksi absensi');
        toast.success('Koreksi absensi tercatat');
      },
      overridePerformance: (reportId, studentId, score, reason) => {
        let nextReport: SessionReport | null = null;
        set((state) => {
          const report = state.sessionReports.find((item) => item.id === reportId);
          if (!report) return state;
          const old = report.students.find((item) => item.studentId === studentId);
          nextReport = {
            ...report,
            students: report.students.map((item) =>
              item.studentId === studentId ? { ...item, performanceScore: score } : item
            )
          };
          pushAudit(state, {
            action: 'override_performance',
            entity: 'session_reports',
            recordId: reportId,
            oldValue: old?.performanceScore,
            newValue: score,
            reason
          });
          return {
            sessionReports: state.sessionReports.map((item) => (item.id === reportId ? nextReport! : item)),
            auditLogs: state.auditLogs
          };
        });
        if (nextReport) void safeRemote(() => upsertSessionReportRemote(nextReport!), 'Koreksi nilai');
        toast.success('Koreksi nilai performa tercatat');
      },
      reviewRecording: (reportId, notes) => {
        let nextReport: SessionReport | null = null;
        set((state) => {
          nextReport = state.sessionReports.find((item) => item.id === reportId)
            ? {
                ...state.sessionReports.find((item) => item.id === reportId)!,
                qaReviewStatus: 'Reviewed' as const,
                qaReviewerId: state.currentUser?.id,
                qaReviewedAt: new Date().toISOString(),
                qaReviewNotes: notes
              }
            : null;
          return {
            sessionReports: state.sessionReports.map((item) =>
              item.id === reportId && nextReport ? nextReport : item
            )
          };
        });
        if (nextReport) void safeRemote(() => upsertSessionReportRemote(nextReport!), 'Review rekaman');
        toast.success('Review rekaman disimpan');
      },
      upsertQaScore: (senseiId, month, score, notes) => {
        let saved: TeachingQaScore | null = null;
        set((state) => {
          const existing = state.qaScores.find((item) => item.senseiId === senseiId && item.month === month);
          const next: TeachingQaScore = {
            id: existing?.id ?? createId(),
            senseiId,
            month,
            score,
            notes,
            createdBy: state.currentUser?.id ?? 'unknown',
            createdAt: existing?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          saved = next;
          if (existing && existing.score !== score) {
            pushAudit(state, {
              action: 'override_qa_score',
              entity: 'teaching_qa',
              recordId: next.id,
              oldValue: existing.score,
              newValue: score,
              reason: notes || 'Koreksi skor Teaching Performance'
            });
          }
          return {
            qaScores: existing
              ? state.qaScores.map((item) => (item.id === existing.id ? next : item))
              : [next, ...state.qaScores],
            auditLogs: state.auditLogs
          };
        });
        if (saved) void safeRemote(() => upsertQaRemote(saved!), 'Simpan QA');
        toast.success('Skor Teaching Performance disimpan');
      },
      overrideSenseiStatus: (senseiId, status, reason) => {
        const existing = get().sensei.find((item) => item.id === senseiId);
        set((state) => {
          if (!existing) return state;
          pushAudit(state, {
            action: 'override_sensei_status',
            entity: 'sensei',
            recordId: senseiId,
            oldValue: existing.primaryStatus,
            newValue: status,
            reason
          });
          return {
            sensei: state.sensei.map((item) =>
              item.id === senseiId ? { ...item, primaryStatus: status } : item
            ),
            auditLogs: state.auditLogs
          };
        });
        void safeRemote(
          () =>
            upsertSenseiStatusRemote({
              senseiId,
              primaryStatus: status,
              joinDate: existing?.joinDate,
              updatedBy: get().currentUser?.email
            }),
          'Update status Sensei'
        );
        toast.success('Status Sensei diubah');
      },
      updateSenseiTimezone: (senseiId, timezone) => {
        const existing = get().sensei.find((item) => item.id === senseiId);
        if (!existing) return;
        set((state) => {
          pushAudit(state, {
            action: 'update_sensei_timezone',
            entity: 'sensei',
            recordId: senseiId,
            oldValue: existing.timezone,
            newValue: timezone
          });
          return {
            sensei: state.sensei.map((item) => (item.id === senseiId ? { ...item, timezone } : item)),
            auditLogs: state.auditLogs
          };
        });
        void safeRemote(() => upsertSenseiTimezoneRemote(senseiId, timezone), 'Update timezone Sensei');
        toast.success('Timezone Sensei disimpan');
      },
      upsertSensei: (input) => {
        if (!input.name.trim()) {
          toast.error('Nama Sensei wajib');
          return null;
        }
        if (!input.email.trim()) {
          toast.error('Email Sensei wajib');
          return null;
        }
        const id = input.id ?? createId();
        const next: Sensei = {
          ...input,
          id,
          name: input.name.trim(),
          displayName: input.displayName?.trim() || undefined,
          email: input.email.trim().toLowerCase(),
          phone: input.phone?.trim() || '',
          levels: input.levels || [],
          joinDate: input.joinDate || new Date().toISOString().slice(0, 10),
          timezone: input.timezone || 'Asia/Jakarta',
          primaryStatus: input.primaryStatus || 'ACTIVE'
        };
        set((current) => {
          const exists = current.sensei.some((item) => item.id === id);
          pushAudit(current, {
            action: exists ? 'update_sensei' : 'create_sensei',
            entity: 'sensei',
            recordId: id,
            newValue: next
          });
          return {
            sensei: exists
              ? current.sensei.map((item) => (item.id === id ? next : item))
              : [next, ...current.sensei],
            auditLogs: current.auditLogs
          };
        });
        void safeRemote(() => upsertSenseiRemote(next), 'Simpan Sensei');
        toast.success('Sensei disimpan');
        return id;
      },
      setSenseiLeave: (senseiId, leave, reason) => {
        const sensei = get().sensei.find((item) => item.id === senseiId);
        if (!sensei) {
          toast.error('Sensei tidak ditemukan');
          return false;
        }
        if (leave && leave.endDate < leave.startDate) {
          toast.error('Tanggal cuti tidak valid');
          return false;
        }
        set((current) => {
          const without = current.leavePeriods.filter((item) => item.senseiId !== senseiId);
          const nextLeave = leave
            ? [
                {
                  id: createId(),
                  senseiId,
                  startDate: leave.startDate,
                  endDate: leave.endDate,
                  reason: reason || 'CUTI',
                  status: 'approved' as const
                },
                ...without
              ]
            : without;
          pushAudit(current, {
            action: leave ? 'set_sensei_leave' : 'clear_sensei_leave',
            entity: 'sensei_status',
            recordId: senseiId,
            newValue: leave,
            reason
          });
          return { leavePeriods: nextLeave, auditLogs: current.auditLogs };
        });
        void safeRemote(
          () =>
            upsertSenseiStatusRemote({
              senseiId,
              primaryStatus: sensei.primaryStatus,
              joinDate: sensei.joinDate,
              leaveStart: leave?.startDate ?? null,
              leaveEnd: leave?.endDate ?? null,
              updatedBy: get().currentUser?.email
            }),
          'Simpan cuti Sensei'
        );
        toast.success(leave ? 'Periode CUTI disimpan' : 'Periode CUTI dihapus');
        return true;
      },
      upsertStudent: (input) => {
        if (!input.name.trim()) {
          toast.error('Nama siswa wajib');
          return null;
        }
        const id = input.id ?? createId();
        const next: Student = {
          ...input,
          id,
          name: input.name.trim(),
          email: input.email?.trim() || undefined,
          phone: input.phone?.trim() || undefined,
          type: input.type || 'Private',
          currentLevel: input.currentLevel || input.startingLevel || '',
          startingLevel: input.startingLevel || input.currentLevel || '',
          isActive: input.isActive !== false,
          academicNotes: input.academicNotes?.trim() || undefined
        };
        set((current) => {
          const exists = current.students.some((item) => item.id === id);
          pushAudit(current, {
            action: exists ? 'update_student' : 'create_student',
            entity: 'students',
            recordId: id,
            newValue: next
          });
          return {
            students: exists
              ? current.students.map((item) => (item.id === id ? next : item))
              : [next, ...current.students],
            auditLogs: current.auditLogs
          };
        });
        void safeRemote(() => upsertStudentRemote(next), 'Simpan siswa');
        toast.success('Siswa disimpan');
        return id;
      },
      upsertEnrollment: (input) => {
        if (!input.studentId || !input.level.trim()) {
          toast.error('Siswa dan level wajib');
          return null;
        }
        const id = input.id ?? createId();
        const next: Enrollment = {
          ...input,
          id,
          level: input.level.trim(),
          status: input.status || 'active',
          paymentStatus: input.paymentStatus ?? 'BELUM_BAYAR',
          requiredMeetings: input.requiredMeetings ?? null,
          sessionsCompleted: input.sessionsCompleted ?? 0,
          updatedAt: new Date().toISOString(),
          updatedBy: get().currentUser?.name
        };
        set((current) => {
          const exists = current.enrollments.some((item) => item.id === id);
          pushAudit(current, {
            action: exists ? 'update_enrollment' : 'create_enrollment',
            entity: 'enrollments',
            recordId: id,
            newValue: next
          });
          const students = current.students.map((student) => {
            if (student.id !== next.studentId) return student;
            if (next.status !== 'active' && next.status !== 'ending_soon') return student;
            return {
              ...student,
              currentLevel: next.level || student.currentLevel,
              type: next.classType || student.type,
              senseiId: next.senseiId || student.senseiId
            };
          });
          return {
            enrollments: exists
              ? current.enrollments.map((item) => (item.id === id ? next : item))
              : [next, ...current.enrollments],
            students,
            auditLogs: current.auditLogs
          };
        });
        void safeRemote(async () => {
          await upsertEnrollmentRemote(next);
          const student = get().students.find((item) => item.id === next.studentId);
          if (student) await upsertStudentRemote(student);
        }, 'Simpan enrollment');
        toast.success('Enrollment disimpan');
        return id;
      },
      updateSettings: (patch) => {
        const previous = get().settings;
        const next = { ...previous, ...patch };
        set((state) => {
          pushAudit(state, {
            action: 'update_app_settings',
            entity: 'app_settings',
            recordId: 'app_settings',
            oldValue: previous,
            newValue: next
          });
          return { settings: next, auditLogs: state.auditLogs };
        });
        void safeRemote(() => upsertAppSettingsRemote(next, get().currentUser?.email), 'Simpan pengaturan');
        toast.success('Pengaturan disimpan');
      },
      completeLevel: ({ studentId, level, nextLevel, notes }) => {
        const state = get();
        const student = state.students.find((item) => item.id === studentId);
        if (!student) {
          toast.error('Siswa tidak ditemukan');
          return false;
        }
        if (state.levelCompletions.some((item) => item.studentId === studentId && item.level === level)) {
          toast.error('Level ini sudah ditandai completed');
          return false;
        }
        const completion: LevelCompletion = {
          id: createId(),
          studentId,
          level,
          nextLevel,
          completedAt: new Date().toISOString(),
          completedBy: state.currentUser?.id ?? 'unknown',
          notes
        };
        const updatedStudent = {
          ...student,
          currentLevel: nextLevel || student.currentLevel,
          academicNotes: notes
            ? [student.academicNotes, `Completed ${level}: ${notes}`].filter(Boolean).join(' · ')
            : student.academicNotes
        };
        // Inherit the target from the next level's class so progress / "mau habis"
        // works right away instead of falling back to a hardcoded number.
        const nextClass = nextLevel
          ? state.classMasters.find(
              (c) =>
                c.level === nextLevel &&
                c.studentIds.includes(studentId) &&
                (c.status === 'active' || c.status === 'ready')
            )
          : undefined;
        const journey = progressEnrollmentJourney({
          enrollments: state.enrollments,
          studentId,
          completedLevel: level,
          nextLevel,
          createId,
          actorName: state.currentUser?.name,
          classType: nextClass?.type ?? student.type,
          senseiId: nextClass?.senseiId ?? student.senseiId ?? null,
          classId: nextClass?.id ?? null,
          requiredMeetings: nextClass?.requiredMeetings ?? null,
          plannedEndDate: nextClass?.plannedEndDate ?? null,
          notes
        });
        set((current) => {
          pushAudit(current, {
            action: 'complete_level',
            entity: 'level_completions',
            recordId: completion.id,
            oldValue: { currentLevel: student.currentLevel },
            newValue: { level, nextLevel, enrollments: journey.changed.map((item) => item.id) },
            reason: notes
          });
          return {
            levelCompletions: [completion, ...current.levelCompletions],
            enrollments: journey.enrollments,
            students: current.students.map((item) => (item.id === studentId ? updatedStudent : item)),
            auditLogs: current.auditLogs
          };
        });
        void safeRemote(async () => {
          await upsertLevelCompletionRemote(completion);
          await upsertStudentRemote(updatedStudent);
          for (const enrollment of journey.changed) {
            await upsertEnrollmentRemote(enrollment);
          }
        }, 'Tandai level selesai');
        toast.success(nextLevel ? `Level ${level} completed → ${nextLevel}` : `Level ${level} completed`);
        return true;
      },
      upsertClassMaster: (input) => {
        const state = get();
        if (!input.displayName.trim()) {
          toast.error('Nama kelas wajib diisi');
          return null;
        }
        if (!input.senseiId || input.studentIds.length === 0) {
          toast.error('Sensei dan minimal 1 siswa wajib');
          return null;
        }
        const compositionError = classCompositionError(input.type, input.studentIds);
        if (compositionError) {
          toast.error(compositionError);
          return null;
        }
        const id = input.id ?? createId();
        const next: ClassMaster = {
          ...input,
          id,
          requiredMeetings: Math.max(1, input.requiredMeetings || 10),
          sessionDurationMinutes: Math.max(30, input.sessionDurationMinutes || 90),
          updatedAt: new Date().toISOString(),
          updatedBy: state.currentUser?.name
        };
        const ensured = ensureClassEnrollments({
          enrollments: state.enrollments,
          teachingClass: next,
          createId,
          actorName: state.currentUser?.name
        });
        set((current) => {
          const exists = current.classMasters.some((item) => item.id === id);
          pushAudit(current, {
            action: exists ? 'update_class_master' : 'create_class_master',
            entity: 'class_masters',
            recordId: id,
            newValue: { class: next, enrollmentIds: ensured.changed.map((item) => item.id) }
          });
          return {
            classMasters: exists
              ? current.classMasters.map((item) => (item.id === id ? next : item))
              : [next, ...current.classMasters],
            enrollments: ensured.enrollments,
            auditLogs: current.auditLogs
          };
        });
        void safeRemote(async () => {
          await upsertClassMasterRemote(next);
          for (const enrollment of ensured.changed) {
            await upsertEnrollmentRemote(enrollment);
          }
        }, 'Simpan Class Master');
        toast.success('Class Master disimpan');
        return id;
      },
      generateClassSchedule: ({ classId, startDate, weekdays, startTime, meetings }) => {
        const state = get();
        const teachingClass = state.classMasters.find((item) => item.id === classId);
        if (!teachingClass) {
          toast.error('Class Master tidak ditemukan');
          return 0;
        }
        if (weekdays.length === 0) {
          toast.error('Pilih minimal 1 hari berulang');
          return 0;
        }
        const count = meetings ?? teachingClass.requiredMeetings;
        const dates = generateRecurringDates(startDate, weekdays, count);
        if (!dates.length) {
          toast.error('Tidak ada tanggal yang bisa digenerate');
          return 0;
        }
        const endTime = addMinutesToTime(startTime, teachingClass.sessionDurationMinutes);
        const created: ClassSession[] = [];
        for (const date of dates) {
          const session: ClassSession = {
            id: createId(),
            classId,
            senseiId: teachingClass.senseiId,
            studentIds: teachingClass.studentIds,
            type: teachingClass.type,
            level: teachingClass.level,
            date,
            startTime,
            endTime,
            status: 'active',
            updatedAt: new Date().toISOString(),
            updatedBy: state.currentUser?.name
          };
          if (wouldConflict([...state.schedules, ...created], session)) {
            toast.error(`Bentrok di ${date} ${startTime}. Generate dibatalkan.`);
            return 0;
          }
          created.push(session);
        }
        const plannedEnd = suggestPlannedEndDate(startDate, weekdays, count);
        const schedulesAfter = [...created, ...state.schedules];
        const updatedClass: ClassMaster = {
          ...teachingClass,
          startDate,
          plannedEndDate: teachingClass.plannedEndDate || plannedEnd,
          projectedEndDate: computeProjectedEndDate(classId, schedulesAfter) || plannedEnd,
          status: teachingClass.status === 'draft' ? 'ready' : teachingClass.status,
          updatedAt: new Date().toISOString(),
          updatedBy: state.currentUser?.name
        };
        set((current) => {
          pushAudit(current, {
            action: 'generate_class_schedule',
            entity: 'class_masters',
            recordId: classId,
            newValue: { sessions: created.length, startDate, weekdays, startTime }
          });
          return {
            schedules: [...created, ...current.schedules],
            classMasters: current.classMasters.map((item) => (item.id === classId ? updatedClass : item)),
            auditLogs: current.auditLogs
          };
        });
        void safeRemote(async () => {
          await upsertClassMasterRemote(updatedClass);
          for (const session of created) await upsertScheduleRemote(session);
        }, 'Generate jadwal berulang');
        toast.success(
          `${created.length} sesi digenerate (Sesi 1–${created.length} dari ${teachingClass.requiredMeetings})`
        );
        return created.length;
      },
      upsertUser: (user) => {
        set((state) => {
          const id = user.id ?? createId();
          const next = { ...user, id };
          const exists = state.users.some((item) => item.id === id);
          return {
            users: exists ? state.users.map((item) => (item.id === id ? next : item)) : [...state.users, next]
          };
        });
        toast.success('Pengguna disimpan');
      },
      createUserLogin: async (input) => {
        const state = get();
        if (state.currentUser?.role !== 'Super Admin') {
          toast.error('Hanya Super Admin yang bisa membuat akun login');
          return false;
        }
        const result = await createAuthLogin({
          email: input.email,
          password: input.password,
          role: input.role,
          status: input.status ?? 'Approved',
          name: input.name,
          senseiId: input.senseiId
        });
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        const account: UserAccount = {
          id: result.userId,
          name: input.name || input.email.split('@')[0],
          email: input.email.trim().toLowerCase(),
          role: input.role,
          status: input.status ?? 'Approved',
          senseiId: input.senseiId
        };
        set((current) => {
          pushAudit(current, {
            action: 'create_user_login',
            entity: 'profiles',
            recordId: result.userId,
            newValue: {
              email: account.email,
              role: account.role,
              status: account.status,
              senseiId: account.senseiId || null
            },
            reason: 'Akun login dibuat dari dashboard'
          });
          const exists = current.users.some((item) => item.id === account.id || item.email === account.email);
          return {
            users: exists
              ? current.users.map((item) =>
                  item.id === account.id || item.email === account.email ? { ...item, ...account } : item
                )
              : [account, ...current.users],
            auditLogs: current.auditLogs
          };
        });
        toast.success(`Akun login ${account.email} siap (Approved). Sensei bisa masuk sekarang.`);
        return true;
      },
      updateUser: async (userId, patch) => {
        const state = get();
        if (state.currentUser?.role !== 'Super Admin') {
          toast.error('Hanya Super Admin yang bisa mengubah akun');
          return false;
        }
        const existing = state.users.find((item) => item.id === userId);
        const remotePatch: { role?: string; status?: string; sensei_id?: string | null } = {};
        if (patch.role) remotePatch.role = patch.role;
        if (patch.status) remotePatch.status = patch.status;
        if (patch.senseiId !== undefined) remotePatch.sensei_id = patch.senseiId || null;
        try {
          await updateProfileRemote(userId, remotePatch);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Gagal menyimpan akun');
          return false;
        }
        set((current) => {
          pushAudit(current, {
            action: 'update_user',
            entity: 'profiles',
            recordId: userId,
            oldValue: existing
              ? { role: existing.role, status: existing.status, senseiId: existing.senseiId ?? null }
              : undefined,
            newValue: {
              role: patch.role ?? existing?.role,
              status: patch.status ?? existing?.status,
              senseiId: patch.senseiId ?? existing?.senseiId ?? null
            },
            reason: 'Ubah role/status/tautan Sensei dari dashboard'
          });
          const linkedSensei =
            patch.senseiId !== undefined
              ? current.sensei.find((item) => item.id === patch.senseiId)
              : undefined;
          return {
            users: current.users.map((item) =>
              item.id === userId
                ? {
                    ...item,
                    role: patch.role ?? item.role,
                    status: patch.status ?? item.status,
                    senseiId: patch.senseiId !== undefined ? patch.senseiId || undefined : item.senseiId,
                    name: linkedSensei?.name || item.name
                  }
                : item
            ),
            currentUser:
              current.currentUser?.id === userId
                ? {
                    ...current.currentUser,
                    role: patch.role ?? current.currentUser.role,
                    status: patch.status ?? current.currentUser.status,
                    senseiId:
                      patch.senseiId !== undefined
                        ? patch.senseiId || undefined
                        : current.currentUser.senseiId
                  }
                : current.currentUser,
            auditLogs: current.auditLogs
          };
        });
        toast.success('Akun diperbarui');
        return true;
      },
      deleteUser: async (userId) => {
        const state = get();
        if (state.currentUser?.role !== 'Super Admin') {
          toast.error('Hanya Super Admin yang bisa menghapus akun');
          return false;
        }
        if (state.currentUser?.id === userId) {
          toast.error('Tidak bisa menghapus akun sendiri');
          return false;
        }
        const existing = state.users.find((item) => item.id === userId);
        try {
          await deleteProfileRemote(userId);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Gagal menghapus akun');
          return false;
        }
        set((current) => {
          pushAudit(current, {
            action: 'delete_user',
            entity: 'profiles',
            recordId: userId,
            oldValue: existing
              ? { email: existing.email, role: existing.role, status: existing.status }
              : undefined,
            reason: 'Akun login dihapus dari dashboard'
          });
          return {
            users: current.users.filter((item) => item.id !== userId),
            auditLogs: current.auditLogs
          };
        });
        toast.success('Akun login dihapus. Blokir juga di Supabase Authentication bila perlu.');
        return true;
      },
      deleteSensei: async (senseiId) => {
        const state = get();
        if (state.currentUser?.role !== 'Super Admin') {
          toast.error('Hanya Super Admin yang bisa menghapus Sensei');
          return false;
        }
        const existing = state.sensei.find((item) => item.id === senseiId);
        if (!existing) return false;
        const blockers: string[] = [];
        if (state.schedules.some((x) => x.senseiId === senseiId || x.originalSenseiId === senseiId))
          blockers.push('jadwal');
        if (state.availability.some((x) => x.senseiId === senseiId)) blockers.push('ketersediaan');
        if (state.sessionLogs.some((x) => x.senseiId === senseiId)) blockers.push('log sesi');
        if (state.classMasters.some((x) => x.senseiId === senseiId)) blockers.push('Class Master');
        if (state.qaScores.some((x) => x.senseiId === senseiId)) blockers.push('skor QA');
        if (blockers.length) {
          toast.error(`Tidak bisa hapus — masih ada ${blockers.join(', ')}. Set INACTIVE saja.`);
          return false;
        }
        try {
          await deleteSenseiRemote(senseiId);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Gagal menghapus Sensei');
          return false;
        }
        set((current) => {
          pushAudit(current, {
            action: 'delete_sensei',
            entity: 'sensei',
            recordId: senseiId,
            oldValue: { name: existing.name, email: existing.email },
            reason: 'Sensei dihapus dari dashboard (belum ada data terkait)'
          });
          return {
            sensei: current.sensei.filter((item) => item.id !== senseiId),
            leavePeriods: current.leavePeriods.filter((item) => item.senseiId !== senseiId),
            users: current.users.map((item) =>
              item.senseiId === senseiId ? { ...item, senseiId: undefined } : item
            ),
            auditLogs: current.auditLogs
          };
        });
        toast.success('Sensei dihapus');
        return true;
      },
      deleteStudent: async (studentId) => {
        const state = get();
        if (state.currentUser?.role !== 'Super Admin') {
          toast.error('Hanya Super Admin yang bisa menghapus siswa');
          return false;
        }
        const existing = state.students.find((item) => item.id === studentId);
        if (!existing) return false;
        const blockers: string[] = [];
        if (state.enrollments.some((x) => x.studentId === studentId)) blockers.push('enrollment');
        if (state.levelCompletions.some((x) => x.studentId === studentId)) blockers.push('level completion');
        if (state.sessionReports.some((r) => r.students.some((st) => st.studentId === studentId)))
          blockers.push('laporan sesi');
        if (state.schedules.some((x) => x.studentIds.includes(studentId))) blockers.push('jadwal');
        if (blockers.length) {
          toast.error(`Tidak bisa hapus — masih ada ${blockers.join(', ')}. Set "Tidak aktif" saja.`);
          return false;
        }
        try {
          await deleteStudentRemote(studentId);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Gagal menghapus siswa');
          return false;
        }
        set((current) => {
          pushAudit(current, {
            action: 'delete_student',
            entity: 'students',
            recordId: studentId,
            oldValue: { name: existing.name },
            reason: 'Siswa dihapus dari dashboard (belum ada data terkait)'
          });
          return {
            students: current.students.filter((item) => item.id !== studentId),
            auditLogs: current.auditLogs
          };
        });
        toast.success('Siswa dihapus');
        return true;
      },
      deleteClassMaster: async (classId) => {
        const state = get();
        if (state.currentUser?.role !== 'Super Admin') {
          toast.error('Hanya Super Admin yang bisa menghapus Class Master');
          return false;
        }
        const existing = state.classMasters.find((item) => item.id === classId);
        if (!existing) return false;
        const blockers: string[] = [];
        if (state.schedules.some((x) => x.classId === classId)) blockers.push('jadwal (termasuk yang dibatalkan)');
        if (state.enrollments.some((x) => x.classId === classId)) blockers.push('enrollment siswa');
        if (blockers.length) {
          toast.error(`Tidak bisa hapus — masih ada ${blockers.join(', ')}. Set Cancelled/Draft saja.`);
          return false;
        }
        try {
          await deleteClassMasterRemote(classId);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Gagal menghapus Class Master');
          return false;
        }
        set((current) => {
          pushAudit(current, {
            action: 'delete_class_master',
            entity: 'class_masters',
            recordId: classId,
            oldValue: { displayName: existing.displayName, level: existing.level },
            reason: 'Class Master dihapus dari dashboard (belum ada jadwal/enrollment terkait)'
          });
          return {
            classMasters: current.classMasters.filter((item) => item.id !== classId),
            auditLogs: current.auditLogs
          };
        });
        toast.success('Class Master dihapus');
        return true;
      }
    }),
    {
      name: 'ans-dashboard-v3-ui',
      partialize: (state) => ({
        activeTab: state.activeTab,
        weekAnchor: state.weekAnchor
      })
    }
  )
);

export function usePermissions(): Permissions {
  const role = useDashboardStore((state) => state.currentUser?.role ?? 'Sensei');
  return getPermissions(role as AppRole);
}

export function useScopedData() {
  const currentUser = useDashboardStore((state) => state.currentUser);
  const sensei = useDashboardStore((state) => state.sensei);
  const students = useDashboardStore((state) => state.students);
  const classMasters = useDashboardStore((state) => state.classMasters);
  const schedules = useDashboardStore((state) => state.schedules);
  const availability = useDashboardStore((state) => state.availability);
  const sessionLogs = useDashboardStore((state) => state.sessionLogs);
  const sessionReports = useDashboardStore((state) => state.sessionReports);
  const qaScores = useDashboardStore((state) => state.qaScores);
  const permissions = getPermissions(currentUser?.role ?? 'Sensei');
  const linkedSenseiId = resolveSenseiId(sensei, {
    senseiId: currentUser?.senseiId,
    email: currentUser?.email
  });

  if (permissions.canViewAllSchedules) {
    return {
      sensei,
      students,
      classMasters,
      schedules,
      availability,
      sessionLogs,
      sessionReports,
      qaScores,
      linkedSenseiId
    };
  }

  const senseiId = linkedSenseiId;
  return {
    sensei: sensei.filter((item) => item.id === senseiId),
    students: students.filter((item) => item.senseiId === senseiId),
    classMasters: classMasters.filter((item) => item.senseiId === senseiId),
    schedules: schedules.filter((item) => item.senseiId === senseiId),
    availability: availability.filter((item) => item.senseiId === senseiId),
    sessionLogs: sessionLogs.filter((item) => item.senseiId === senseiId),
    sessionReports: sessionReports.filter((item) =>
      schedules.some((session) => session.id === item.scheduleId && session.senseiId === senseiId)
    ),
    qaScores: qaScores.filter((item) => item.senseiId === senseiId),
    linkedSenseiId
  };
}
