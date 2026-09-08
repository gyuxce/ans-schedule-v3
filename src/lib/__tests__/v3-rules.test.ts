import { describe, expect, it } from 'vitest';
import { getPermissions } from '../rbac';
import { getOperationalLabels } from '../labels';
import { getWorkloadMetrics, getDayCapacity, formatHoursShort } from '../workload';
import { findConflicts } from '../schedule';
import { getDisciplinaryMetrics } from '../disciplinary';
import { getSessionWorkflow, isLateJoin } from '../session';
import { filterAcademicReportRows, hasActiveOrCompletedMakeup } from '../makeup';
import { addMinutesToTime, generateRecurringDates } from '../recurring';
import { classCompositionError } from '../classComposition';
import {
  getClassHealth,
  getClassProgress,
  getSessionOrdinal,
  getSessionStrip,
  computeProjectedEndDate
} from '../classProgress';
import { buildRecurringPreview } from '../schedulePreview';
import { buildEomSessionRows, eomRowsToCsv, summarizeEomBySensei } from '../eomReport';
import { buildActionItems } from '../actionCenter';
import {
  actualDurationMinutes,
  durationVarianceMinutes,
  formatDurationMinutes,
  scheduledDurationMinutes
} from '../duration';
import {
  ensureClassEnrollments,
  progressEnrollmentJourney,
  deriveEnrollmentDisplayStatus,
  getEnrollmentProgress
} from '../enrollment';
import { resolveSenseiId } from '../senseiLink';
import type { ClassMaster, ClassSession, Sensei } from '../../types';

const yuki: Sensei = {
  id: 's1',
  name: 'Yuki',
  email: 'yuki@test.com',
  phone: '',
  levels: ['N5'],
  primaryStatus: 'ACTIVE',
  joinDate: '2026-07-20',
  timezone: 'Asia/Jakarta'
};

const classOf = (
  partial: Partial<ClassSession> & Pick<ClassSession, 'id' | 'date' | 'startTime' | 'endTime'>
): ClassSession => ({
  senseiId: 's1',
  studentIds: ['st1'],
  type: 'Private',
  level: 'N5',
  status: 'active',
  ...partial
});

describe('RBAC', () => {
  it('keeps official schedule edits to Super Admin only', () => {
    expect(getPermissions('Super Admin').canEditOfficialSchedule).toBe(true);
    expect(getPermissions('Kyouiku').canEditOfficialSchedule).toBe(false);
    expect(getPermissions('Sensei').canEditOfficialSchedule).toBe(false);
    expect(getPermissions('Sensei').canViewAllSchedules).toBe(false);
    expect(getPermissions('Kyouiku').canEditQa).toBe(true);
    expect(getPermissions('Kyouiku').canOverrideAcademic).toBe(true);
    expect(getPermissions('Super Admin').canManageUsers).toBe(true);
    expect(getPermissions('Super Admin').canExportEomReport).toBe(true);
    expect(getPermissions('Kyouiku').canExportEomReport).toBe(false);
    expect(getPermissions('Sensei').canExportEomReport).toBe(false);
  });
});

describe('Sensei labels', () => {
  it('can combine ACTIVE + NEW + UNASSIGNED', () => {
    const labels = getOperationalLabels(yuki, [], [], new Date('2026-08-14'));
    expect(labels).toContain('NEW');
    expect(labels).toContain('UNASSIGNED');
  });

  it('adds CUTI from approved leave', () => {
    const labels = getOperationalLabels(
      yuki,
      [classOf({ id: 'c1', date: '2026-08-14', startTime: '09:00', endTime: '10:00' })],
      [
        {
          id: 'l1',
          senseiId: 's1',
          startDate: '2026-08-10',
          endDate: '2026-08-20',
          reason: 'cuti',
          status: 'approved'
        }
      ],
      new Date('2026-08-14')
    );
    expect(labels).toContain('CUTI');
    expect(labels).not.toContain('UNASSIGNED');
  });
});

describe('workload', () => {
  it('calculates available, assigned, remaining, utilization, and gap to the default target', () => {
    const metrics = getWorkloadMetrics(
      's1',
      [
        {
          id: 'a1',
          senseiId: 's1',
          pattern: 'weekly',
          weekday: 5,
          startTime: '08:00',
          endTime: '12:00',
          isActive: true
        },
        {
          id: 'a2',
          senseiId: 's1',
          pattern: 'weekly',
          weekday: 1,
          startTime: '09:00',
          endTime: '17:00',
          isActive: true
        }
      ],
      [classOf({ id: 'c1', date: '2026-08-14', startTime: '09:00', endTime: '11:00' })],
      '2026-08-14'
    );
    expect(metrics.availableHours).toBe(12);
    expect(metrics.assignedHours).toBe(2);
    expect(metrics.remainingHours).toBe(10);
    expect(metrics.utilization).toBeCloseTo(2 / 12);
    // default weekly target is 10h; explicit target overrides it
    expect(metrics.targetGap).toBe(8);
    expect(getWorkloadMetrics('s1', [], [], '2026-08-14', 20).targetGap).toBe(20);
  });

  it('builds day capacity from weekly slots and official sessions', () => {
    const slots = [
      {
        id: 'a1',
        senseiId: 's1',
        pattern: 'weekly' as const,
        weekday: 5,
        startTime: '08:00',
        endTime: '12:00',
        isActive: true
      }
    ];
    const cap = getDayCapacity('s1', '2026-08-14', slots, [
      classOf({ id: 'c1', date: '2026-08-14', startTime: '09:00', endTime: '11:00' })
    ]);
    expect(cap.availableHours).toBe(4);
    expect(cap.assignedHours).toBe(2);
    expect(cap.remainingHours).toBe(2);
    expect(cap.slots).toHaveLength(1);
    expect(getDayCapacity('s1', '2026-08-13', slots, []).availableHours).toBe(0);
    expect(formatHoursShort(9)).toBe('9j');
  });
});

describe('schedule conflicts', () => {
  it('detects overlapping classes for the same Sensei', () => {
    const conflicts = findConflicts([
      classOf({ id: 'c1', date: '2026-08-14', startTime: '13:00', endTime: '14:30' }),
      classOf({ id: 'c2', date: '2026-08-14', startTime: '14:00', endTime: '15:30' })
    ]);
    expect(conflicts).toHaveLength(1);
  });
});

describe('session workflow and late join', () => {
  it('follows clock-in → clock-out → report', () => {
    const session = classOf({ id: 'c1', date: '2026-08-14', startTime: '09:00', endTime: '10:00' });
    expect(getSessionWorkflow(session)).toBe('ready');
    expect(
      getSessionWorkflow(session, {
        id: 'l',
        scheduleId: 'c1',
        senseiId: 's1',
        clockInAt: 'x',
        lateJoin: false,
        overridden: false
      })
    ).toBe('in_progress');
  });

  it('marks late join after scheduled start when grace is 0 (Sensei WIB)', () => {
    const session = classOf({ id: 'c1', date: '2026-08-14', startTime: '09:00', endTime: '10:00' });
    // 09:00 Asia/Jakarta = 02:00 UTC
    expect(isLateJoin(session, '2026-08-14T02:00:01.000Z', 0, 'Asia/Jakarta')).toBe(true);
    expect(isLateJoin(session, '2026-08-14T02:00:00.000Z', 0, 'Asia/Jakarta')).toBe(false);
  });

  it('uses Sensei timezone, not a forced WIB clock', () => {
    const session = classOf({ id: 'c1', date: '2026-08-14', startTime: '09:00', endTime: '10:00' });
    // 09:00 Asia/Jayapura (WIT, UTC+9) = 00:00 UTC
    expect(isLateJoin(session, '2026-08-14T00:00:00.000Z', 0, 'Asia/Jayapura')).toBe(false);
    expect(isLateJoin(session, '2026-08-14T00:01:00.000Z', 0, 'Asia/Jayapura')).toBe(true);
    // Same absolute time would be late for WIB (class starts 02:00 UTC)
    expect(isLateJoin(session, '2026-08-14T00:00:00.000Z', 0, 'Asia/Jakarta')).toBe(false);
    expect(isLateJoin(session, '2026-08-14T01:59:00.000Z', 0, 'Asia/Jakarta')).toBe(false);
    expect(isLateJoin(session, '2026-08-14T02:06:00.000Z', 5, 'Asia/Jakarta')).toBe(true);
    expect(isLateJoin(session, '2026-08-14T02:05:00.000Z', 5, 'Asia/Jakarta')).toBe(false);
  });

  it('supports a Sensei teaching from Japan (JST, UTC+9)', () => {
    const session = classOf({ id: 'c1', date: '2026-08-14', startTime: '09:00', endTime: '10:00' });
    // 09:00 Asia/Tokyo (JST, UTC+9) = 00:00 UTC
    expect(isLateJoin(session, '2026-08-14T00:00:00.000Z', 0, 'Asia/Tokyo')).toBe(false);
    expect(isLateJoin(session, '2026-08-14T00:01:00.000Z', 0, 'Asia/Tokyo')).toBe(true);
  });
});

describe('disciplinary attribution', () => {
  it('does not count admin/student swaps against Sensei', () => {
    const metrics = getDisciplinaryMetrics(
      's1',
      '2026-08',
      [
        classOf({
          id: 'c1',
          date: '2026-08-12',
          startTime: '09:00',
          endTime: '10:00',
          originalSenseiId: 's1',
          swapInitiator: 'Admin'
        }),
        classOf({
          id: 'c2',
          date: '2026-08-12',
          startTime: '11:00',
          endTime: '12:00',
          originalSenseiId: 's1',
          swapInitiator: 'Sensei'
        }),
        classOf({
          id: 'c3',
          date: '2026-08-11',
          startTime: '09:00',
          endTime: '10:00',
          status: 'cancelled',
          originalSenseiId: 's1',
          cancellationInitiator: 'Sensei',
          replacementSecured: false
        })
      ],
      []
    );
    expect(metrics.senseiInitiatedSwaps).toBe(1);
    expect(metrics.cancelledNoReplacement).toBe(1);
  });

  it('attributes a Sensei-initiated swap to the original Sensei, not the replacement', () => {
    const sessions = [
      classOf({
        id: 'c2',
        date: '2026-08-12',
        startTime: '11:00',
        endTime: '12:00',
        senseiId: 'replacement',
        originalSenseiId: 's1',
        swapInitiator: 'Sensei'
      })
    ];
    expect(getDisciplinaryMetrics('s1', '2026-08', sessions, []).senseiInitiatedSwaps).toBe(1);
    expect(getDisciplinaryMetrics('replacement', '2026-08', sessions, []).senseiInitiatedSwaps).toBe(0);
  });
});

describe('action center', () => {
  it('surfaces missing reports, conflicts, and unassigned Sensei', () => {
    const items = buildActionItems({
      sensei: [yuki],
      schedules: [
        classOf({ id: 'past', date: '2026-08-12', startTime: '09:00', endTime: '10:00' }),
        classOf({ id: 'a', date: '2026-08-14', startTime: '13:00', endTime: '14:30' }),
        classOf({ id: 'b', date: '2026-08-14', startTime: '14:00', endTime: '15:30' })
      ],
      availability: [],
      logs: [],
      reports: [],
      leavePeriods: [],
      weekAnchor: '2026-08-14',
      now: new Date('2026-08-14T18:00:00')
    });
    expect(items.some((item) => item.kind === 'missing_report')).toBe(true);
    expect(items.some((item) => item.kind === 'schedule_conflict')).toBe(true);
    expect(items.some((item) => item.kind === 'unassigned_sensei')).toBe(false);
  });

  it('does not flood queue with ancient migrated sessions', () => {
    const items = buildActionItems({
      sensei: [yuki],
      schedules: [
        classOf({ id: 'old', date: '2026-01-22', startTime: '19:00', endTime: '20:30' }),
        classOf({ id: 'recent', date: '2026-08-13', startTime: '09:00', endTime: '10:30' })
      ],
      availability: [],
      logs: [],
      reports: [],
      leavePeriods: [],
      weekAnchor: '2026-08-14',
      now: new Date('2026-08-14T18:00:00')
    });
    expect(items.some((item) => item.scheduleId === 'old')).toBe(false);
    expect(items.some((item) => item.scheduleId === 'recent' && item.kind === 'missing_report')).toBe(true);
  });
});

describe('makeup class', () => {
  it('links makeup to cancelled original and drops superseded original from academic rows', () => {
    const original = classOf({
      id: 'orig',
      date: '2026-08-10',
      startTime: '09:00',
      endTime: '10:00',
      status: 'cancelled'
    });
    const makeup = classOf({
      id: 'mk',
      date: '2026-08-14',
      startTime: '09:00',
      endTime: '10:00',
      makeupOfSessionId: 'orig'
    });
    const schedules = [original, makeup];
    expect(hasActiveOrCompletedMakeup('orig', schedules)).toBe(true);

    const rows = [
      {
        session: original,
        report: {
          id: 'r1',
          scheduleId: 'orig',
          submittedBy: 'x',
          submittedAt: '',
          students: [],
          materialCovered: 'old',
          levelProgress: '',
          recordingStatus: 'Missing' as const,
          qaReviewStatus: 'Not Reviewed' as const
        }
      },
      {
        session: makeup,
        report: {
          id: 'r2',
          scheduleId: 'mk',
          submittedBy: 'x',
          submittedAt: '',
          students: [],
          materialCovered: 'makeup',
          levelProgress: '',
          recordingStatus: 'Missing' as const,
          qaReviewStatus: 'Not Reviewed' as const
        }
      }
    ];
    const filtered = filterAcademicReportRows(rows, schedules);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].session.id).toBe('mk');
  });
});

describe('recurring + session X of X + class health', () => {
  it('generates recurring dates on selected weekdays', () => {
    const dates = generateRecurringDates('2026-08-17', [1, 5], 4);
    expect(dates).toEqual(['2026-08-17', '2026-08-21', '2026-08-24', '2026-08-28']);
  });

  it('computes session ordinal and overdue/ending soon health', () => {
    const teachingClass: ClassMaster = {
      id: 'c1',
      displayName: 'Private Aiko N5',
      type: 'Private',
      level: 'N5',
      senseiId: 's1',
      studentIds: ['st1'],
      requiredMeetings: 4,
      sessionDurationMinutes: 90,
      startDate: '2026-08-01',
      plannedEndDate: '2026-08-10',
      status: 'active'
    };
    const schedules = [
      classOf({
        id: '1',
        classId: 'c1',
        date: '2026-08-03',
        startTime: '09:00',
        endTime: '10:30',
        status: 'completed'
      }),
      classOf({ id: '2', classId: 'c1', date: '2026-08-05', startTime: '09:00', endTime: '10:30' }),
      classOf({
        id: '3',
        classId: 'c1',
        date: '2026-08-07',
        startTime: '09:00',
        endTime: '10:30',
        status: 'cancelled'
      }),
      classOf({ id: '4', classId: 'c1', date: '2026-08-10', startTime: '09:00', endTime: '10:30' })
    ];
    expect(getSessionOrdinal(schedules[1], schedules, teachingClass)?.label).toBe('Sesi 2 dari 4');
    expect(getClassProgress(teachingClass, schedules, []).completed).toBe(1);
    expect(getClassHealth(teachingClass, schedules, [], new Date('2026-08-14')).status).toBe('overdue');
    expect(getClassHealth(teachingClass, schedules, [], new Date('2026-08-09')).status).toBe('ending_soon');
    const strip = getSessionStrip(teachingClass, schedules, [], '2026-08-06');
    expect(strip.map((cell) => cell.state)).toEqual(['completed', 'due', 'next', 'empty']);
  });

  it('builds Mon+Tue recurring preview for 10 meetings at 19:00–20:30', () => {
    const preview = buildRecurringPreview({
      startDate: '2026-08-17',
      weekdays: [1, 2],
      startTime: '19:00',
      durationMinutes: 90,
      requiredMeetings: 10
    });
    expect(preview).toHaveLength(10);
    expect(preview[0]).toMatchObject({
      date: '2026-08-17',
      startTime: '19:00',
      endTime: '20:30',
      label: '1 / 10'
    });
    expect(preview[1].date).toBe('2026-08-18');
    expect(preview[9].label).toBe('10 / 10');
  });

  it('excludes Extra from X/X and keeps planned vs projected end separate', () => {
    const teachingClass: ClassMaster = {
      id: 'c1',
      displayName: 'Private Nathan Pra Guntai',
      type: 'Private',
      level: 'Pra Guntai',
      senseiId: 's1',
      studentIds: ['st1'],
      requiredMeetings: 10,
      sessionDurationMinutes: 90,
      startDate: '2026-08-17',
      plannedEndDate: '2026-09-30',
      projectedEndDate: '2026-10-14',
      status: 'active'
    };
    const schedules = [
      classOf({
        id: '1',
        classId: 'c1',
        date: '2026-08-17',
        startTime: '19:00',
        endTime: '20:30',
        status: 'completed'
      }),
      classOf({ id: '2', classId: 'c1', date: '2026-08-18', startTime: '19:00', endTime: '20:30' }),
      classOf({ id: '3', classId: 'c1', date: '2026-08-24', startTime: '19:00', endTime: '20:30' }),
      classOf({ id: '4', classId: 'c1', date: '2026-10-14', startTime: '19:00', endTime: '20:30' }),
      classOf({
        id: 'x1',
        classId: 'c1',
        date: '2026-10-15',
        startTime: '19:00',
        endTime: '20:30',
        isExtra: true
      })
    ];
    expect(getSessionOrdinal(schedules[4], schedules, teachingClass)?.label).toBe('Extra');
    expect(getClassProgress(teachingClass, schedules, []).calendarCount).toBe(4);
    expect(computeProjectedEndDate('c1', schedules)).toBe('2026-10-14');
    expect(teachingClass.plannedEndDate).toBe('2026-09-30');
    expect(getClassHealth(teachingClass, schedules, [], new Date('2026-08-20')).status).toBe('delayed');
  });
});

describe('class composition rule', () => {
  it('requires Semi-Private to have 2–4 students, others unconstrained', () => {
    expect(classCompositionError('Semi-Private', ['a'])).toBeTruthy();
    expect(classCompositionError('Semi-Private', ['a', 'b', 'c', 'd', 'e'])).toBeTruthy();
    expect(classCompositionError('Semi-Private', ['a', 'b'])).toBeNull();
    expect(classCompositionError('Private', ['a'])).toBeNull();
    expect(classCompositionError('Group', ['a', 'b', 'c', 'd', 'e', 'f'])).toBeNull();
  });
});

describe('addMinutesToTime', () => {
  it('adds duration and clamps at 23:59 instead of wrapping past midnight', () => {
    expect(addMinutesToTime('19:00', 90)).toBe('20:30');
    expect(addMinutesToTime('09:15', 45)).toBe('10:00');
    expect(addMinutesToTime('23:00', 120)).toBe('23:59');
  });
});

describe('EOM report', () => {
  it('builds detail rows and CSV without salary columns', () => {
    const rows = buildEomSessionRows({
      month: '2026-08',
      senseiId: 'all',
      status: 'all',
      schedules: [
        classOf({
          id: '1',
          classId: 'c1',
          date: '2026-08-17',
          startTime: '19:00',
          endTime: '20:30',
          status: 'completed',
          swapInitiator: 'Sensei',
          originalSenseiId: 's0',
          swapReason: 'sakit'
        })
      ],
      sessionLogs: [
        {
          id: 'l1',
          scheduleId: '1',
          senseiId: 's1',
          clockInAt: '2026-08-17T12:05:00.000Z',
          clockOutAt: '2026-08-17T13:30:00.000Z',
          lateJoin: true,
          overridden: false
        }
      ],
      sessionReports: [],
      classMasters: [
        {
          id: 'c1',
          displayName: 'Private Nathan',
          type: 'Private',
          level: 'Pra Guntai',
          senseiId: 's1',
          studentIds: ['st1'],
          requiredMeetings: 10,
          sessionDurationMinutes: 90,
          status: 'active'
        }
      ],
      sensei: [yuki],
      students: [
        {
          id: 'st1',
          name: 'Nathan',
          type: 'Private',
          currentLevel: 'Pra Guntai',
          startingLevel: 'Pra Guntai',
          isActive: true
        }
      ]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionKind).toBe('Regular');
    expect(rows[0].lateJoin).toBe('Yes');
    const summary = summarizeEomBySensei(rows);
    expect(summary[0]?.senseiInitiatedSwaps).toBe(1);
    const csv = eomRowsToCsv(rows, summary);
    expect(csv).toContain('SUMMARY PER SENSEI');
    expect(csv.toLowerCase()).not.toContain('salary');
    expect(csv.toLowerCase()).not.toContain('gaji');
  });
});

describe('duration clock', () => {
  it('computes scheduled, actual, and variance from clock in/out', () => {
    const session = classOf({ id: 'd1', date: '2026-08-14', startTime: '09:00', endTime: '10:30' });
    expect(scheduledDurationMinutes(session)).toBe(90);
    expect(actualDurationMinutes(null)).toBeNull();
    const log = {
      id: 'l1',
      scheduleId: 'd1',
      senseiId: 's1',
      clockInAt: '2026-08-14T02:05:00.000Z',
      clockOutAt: '2026-08-14T03:20:00.000Z',
      lateJoin: true,
      overridden: false
    };
    expect(actualDurationMinutes(log)).toBe(75);
    expect(durationVarianceMinutes(session, log)).toBe(-15);
    expect(formatDurationMinutes(-15)).toBe('−15m');
  });
});

describe('enrollment journey', () => {
  it('closes completed level and opens next without overwriting history', () => {
    const existing = [
      {
        id: 'e1',
        studentId: 'st1',
        level: 'N5',
        status: 'active' as const,
        startDate: '2026-07-01',
        endDate: null
      }
    ];
    const { enrollments, changed } = progressEnrollmentJourney({
      enrollments: existing,
      studentId: 'st1',
      completedLevel: 'N5',
      nextLevel: 'N4',
      createId: () => 'e2',
      actorName: 'Kyouiku'
    });
    expect(changed).toHaveLength(2);
    expect(enrollments.find((item) => item.id === 'e1')?.status).toBe('completed');
    expect(enrollments.find((item) => item.id === 'e1')?.endDate).toBeTruthy();
    expect(enrollments.find((item) => item.id === 'e2')?.status).toBe('active');
    expect(enrollments.find((item) => item.id === 'e2')?.level).toBe('N4');
  });

  it('marks ending soon near required meetings', () => {
    const enrollment = {
      id: 'e1',
      studentId: 'st1',
      level: 'N5',
      status: 'active' as const,
      requiredMeetings: 14,
      sessionsCompleted: 12,
      startDate: '2026-07-01'
    };
    expect(deriveEnrollmentDisplayStatus(enrollment, [], [])).toBe('ending_soon');
    expect(getEnrollmentProgress(enrollment, [], []).completed).toBe(12);
  });

  it('ensures class master students get active enrollments', () => {
    const teachingClass: ClassMaster = {
      id: 'c1',
      displayName: 'N5 Private A',
      type: 'Private',
      level: 'N5',
      senseiId: 's1',
      studentIds: ['st1', 'st2'],
      requiredMeetings: 10,
      sessionDurationMinutes: 90,
      startDate: '2026-08-01',
      status: 'active'
    };
    const { enrollments, changed } = ensureClassEnrollments({
      enrollments: [],
      teachingClass,
      createId: () => crypto.randomUUID()
    });
    expect(changed).toHaveLength(2);
    expect(enrollments.every((item) => item.status === 'active' && item.level === 'N5')).toBe(true);
  });
});

describe('resolveSenseiId', () => {
  const list: Sensei[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Zara',
      email: 'zarasvatipradnya@gmail.com',
      phone: '',
      levels: [],
      primaryStatus: 'ACTIVE',
      joinDate: '2026-01-01',
      timezone: 'Asia/Jakarta'
    }
  ];

  it('matches by email case-insensitively', () => {
    expect(resolveSenseiId(list, { email: 'Zarasvatipradnya@gmail.com' })).toBe(list[0].id);
  });

  it('trusts profiles.sensei_id even when list empty', () => {
    expect(resolveSenseiId([], { senseiId: list[0].id, email: 'other@test.com' })).toBe(list[0].id);
  });
});
