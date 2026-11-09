import type { Sensei } from '../types';

/**
 * Sensei list order used everywhere a Sensei is picked or listed: newest join date first,
 * Sensei with the same join date A-Z. A Sensei without a join date goes last.
 */
export function compareSenseiByJoinDate(
  a: Pick<Sensei, 'name' | 'joinDate'>,
  b: Pick<Sensei, 'name' | 'joinDate'>,
  nameOf: (sensei: Pick<Sensei, 'name' | 'joinDate'>) => string = (sensei) => sensei.name
) {
  const aDate = a.joinDate || '';
  const bDate = b.joinDate || '';
  if (aDate !== bDate) return aDate < bDate ? 1 : -1;
  return nameOf(a).localeCompare(nameOf(b), 'id', { sensitivity: 'base' });
}

export function sortSenseiByJoinDate<T extends Pick<Sensei, 'name' | 'joinDate'>>(list: T[]): T[] {
  return [...list].sort((a, b) => compareSenseiByJoinDate(a, b));
}

/** Active Sensei first (newest join first), inactive ones after them in the same order. */
export function sortSenseiActiveFirst<T extends Pick<Sensei, 'name' | 'joinDate' | 'primaryStatus'>>(
  list: T[]
): T[] {
  return [
    ...sortSenseiByJoinDate(list.filter((item) => item.primaryStatus === 'ACTIVE')),
    ...sortSenseiByJoinDate(list.filter((item) => item.primaryStatus !== 'ACTIVE'))
  ];
}
