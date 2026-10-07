import { addMonths, isWithinInterval, parseISO } from 'date-fns';
import type {
  ClassMaster,
  ClassSession,
  LeavePeriod,
  Sensei,
  SenseiOperationalLabel,
  SenseiPrimaryStatus
} from '../types';

export function isNewSensei(sensei: Sensei, today = new Date()) {
  if (sensei.primaryStatus !== 'ACTIVE') return false;
  const join = parseISO(`${sensei.joinDate}T00:00:00`);
  const expires = addMonths(join, 1);
  return today >= join && today < expires;
}

export function isOnCuti(senseiId: string, leavePeriods: LeavePeriod[], today = new Date()) {
  return leavePeriods.some((leave) => {
    if (leave.senseiId !== senseiId || leave.status !== 'approved') return false;
    return isWithinInterval(today, {
      start: parseISO(`${leave.startDate}T00:00:00`),
      end: parseISO(`${leave.endDate}T23:59:59`)
    });
  });
}

export function hasActiveAssignment(
  senseiId: string,
  schedules: ClassSession[],
  classMasters: ClassMaster[] = []
) {
  if (
    classMasters.some(
      (item) => item.senseiId === senseiId && (item.status === 'active' || item.status === 'ready')
    )
  ) {
    return true;
  }
  return schedules.some((session) => session.senseiId === senseiId && session.status === 'active');
}

export function getOperationalLabels(
  sensei: Sensei,
  schedules: ClassSession[],
  leavePeriods: LeavePeriod[],
  today = new Date(),
  classMasters: ClassMaster[] = []
): SenseiOperationalLabel[] {
  if (sensei.primaryStatus !== 'ACTIVE') return [];
  const labels: SenseiOperationalLabel[] = [];
  if (isNewSensei(sensei, today)) labels.push('NEW');
  if (!hasActiveAssignment(sensei.id, schedules, classMasters)) labels.push('UNASSIGNED');
  if (isOnCuti(sensei.id, leavePeriods, today)) labels.push('CUTI');
  return labels;
}

export function statusTone(status: SenseiPrimaryStatus) {
  return status === 'ACTIVE' ? 'success' : 'muted';
}

export function senseiDisplayName(sensei: Pick<Sensei, 'name' | 'displayName'>) {
  return sensei.displayName?.trim() || sensei.name;
}

const JLPT_ORDER = ['N1', 'N2', 'N3', 'N4', 'N5'];
/** Pull out any JLPT tokens (N1–N5) from the free-form "Level mengajar" list,
 *  highest level first, so it's scannable at a glance in the roster. */
export function jlptLevels(levels: string[]) {
  const found = new Set<string>();
  for (const level of levels) {
    const match = level.toUpperCase().match(/\bN[1-5]\b/);
    if (match) found.add(match[0]);
  }
  return JLPT_ORDER.filter((level) => found.has(level));
}
