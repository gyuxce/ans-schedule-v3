import { describe, expect, it } from 'vitest';
import { getDayCapacity, isValidSlot } from '../workload';
import type { AvailabilitySlot } from '../../types';

const slot = (overrides: Partial<AvailabilitySlot>): AvailabilitySlot => ({
  id: 'a',
  senseiId: 's1',
  pattern: 'weekly',
  weekday: 2,
  date: null,
  startTime: '19:00',
  endTime: '21:00',
  isActive: true,
  ...overrides
});

describe('availability slots with reversed hours', () => {
  const tuesday = '2026-11-10';

  it('flags a slot that ends before it starts', () => {
    expect(isValidSlot(slot({ startTime: '19:00', endTime: '09:00' }))).toBe(false);
    expect(isValidSlot(slot({ startTime: '19:00', endTime: '19:00' }))).toBe(false);
    expect(isValidSlot(slot({}))).toBe(true);
  });

  it('keeps valid hours when a reversed slot sits next to them', () => {
    const slots = [
      slot({ id: 'ok' }),
      slot({ id: 'bad', startTime: '19:00', endTime: '09:30' }),
      slot({ id: 'bad2', startTime: '19:00', endTime: '09:00' })
    ];
    const cap = getDayCapacity('s1', tuesday, slots, []);
    expect(cap.availableHours).toBe(2);
    expect(cap.slots).toHaveLength(3);
  });

  it('reports no hours (but still lists the slot) when only reversed ones exist', () => {
    const cap = getDayCapacity('s1', tuesday, [slot({ startTime: '19:00', endTime: '09:00' })], []);
    expect(cap.availableHours).toBe(0);
    expect(cap.slots).toHaveLength(1);
  });
});
