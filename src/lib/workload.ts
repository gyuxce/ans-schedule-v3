import type { AvailabilitySlot, ClassSession, WorkloadMetrics } from '../types';
import { WEEKLY_HOUR_TARGET } from '../constants';
import { hoursBetween, toDateKey, weekdayOf, weekDays } from './dates';

/** A slot that ends after it starts. Reversed ones come from an AM/PM slip and must not eat the valid hours. */
export function isValidSlot(slot: Pick<AvailabilitySlot, 'startTime' | 'endTime'>) {
  return slot.endTime > slot.startTime;
}

export function slotsOnDate(slots: AvailabilitySlot[], senseiId: string, dateKey: string) {
  const weekday = weekdayOf(dateKey);
  return slots.filter((slot) => {
    if (!slot.isActive || slot.senseiId !== senseiId) return false;
    if (slot.pattern === 'specific_date') return slot.date === dateKey;
    return slot.pattern === 'weekly' && slot.weekday === weekday;
  });
}

export function sessionsOnDate(schedules: ClassSession[], senseiId: string, dateKey: string) {
  return schedules.filter(
    (session) => session.senseiId === senseiId && session.date === dateKey && session.status !== 'cancelled'
  );
}

export function getDayCapacity(
  senseiId: string,
  dateKey: string,
  slots: AvailabilitySlot[],
  schedules: ClassSession[]
) {
  const daySlots = slotsOnDate(slots, senseiId, dateKey);
  const daySessions = sessionsOnDate(schedules, senseiId, dateKey);
  const availableHours = daySlots
    .filter(isValidSlot)
    .reduce((sum, slot) => sum + hoursBetween(slot.startTime, slot.endTime), 0);
  const assignedHours = daySessions.reduce(
    (sum, session) => sum + hoursBetween(session.startTime, session.endTime),
    0
  );
  return {
    slots: daySlots,
    sessions: daySessions,
    availableHours,
    assignedHours,
    remainingHours: availableHours - assignedHours
  };
}

export function availabilityHoursForWeek(
  slots: AvailabilitySlot[],
  senseiId: string,
  weekAnchor: Date | string
) {
  const days = weekDays(weekAnchor);
  let hours = 0;

  for (const day of days) {
    const dateKey = toDateKey(day);
    const weekday = weekdayOf(dateKey);
    for (const slot of slots) {
      if (!slot.isActive || slot.senseiId !== senseiId || !isValidSlot(slot)) continue;
      const matches =
        (slot.pattern === 'specific_date' && slot.date === dateKey) ||
        (slot.pattern === 'weekly' && slot.weekday === weekday);
      if (matches) hours += hoursBetween(slot.startTime, slot.endTime);
    }
  }

  return hours;
}

export function assignedHoursForWeek(schedules: ClassSession[], senseiId: string, weekAnchor: Date | string) {
  const validDates = new Set(weekDays(weekAnchor).map(toDateKey));
  return schedules
    .filter(
      (session) =>
        session.senseiId === senseiId && session.status !== 'cancelled' && validDates.has(session.date)
    )
    .reduce((sum, session) => sum + hoursBetween(session.startTime, session.endTime), 0);
}

export function getWorkloadMetrics(
  senseiId: string,
  slots: AvailabilitySlot[],
  schedules: ClassSession[],
  weekAnchor: Date | string,
  targetHours = WEEKLY_HOUR_TARGET
): WorkloadMetrics {
  const availableHours = availabilityHoursForWeek(slots, senseiId, weekAnchor);
  const assignedHours = assignedHoursForWeek(schedules, senseiId, weekAnchor);
  const remainingHours = availableHours - assignedHours;
  const utilization = availableHours > 0 ? assignedHours / availableHours : null;

  return {
    senseiId,
    availableHours,
    assignedHours,
    remainingHours,
    utilization,
    targetHours,
    targetGap: targetHours - assignedHours,
    targetProgress: Math.min(assignedHours / targetHours, 1)
  };
}

export function formatHours(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} jam` : `${rounded.toFixed(1)} jam`;
}

export function formatHoursShort(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}j` : `${rounded.toFixed(1)}j`;
}

export function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}
