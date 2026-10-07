import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { compactTimeRange, isToday, toDateKey, weekdayOf } from '../../lib/dates';
import { jlptLevels } from '../../lib/labels';
import { formatHoursShort, getDayCapacity } from '../../lib/workload';
import type { AvailabilitySlot, ClassSession } from '../../types';
import { Avatar } from './Avatar';
import { Badge } from './Badge';

export function CapacityHeatmap({
  sensei,
  days,
  availability,
  schedules,
  canEdit,
  onAddDay,
  onDisableSlot
}: {
  sensei: Array<{
    id: string;
    name: string;
    levels: string[];
    canTeachEnglish: boolean;
    canTeachKids: boolean;
  }>;
  days: Date[];
  availability: AvailabilitySlot[];
  schedules: ClassSession[];
  canEdit: (senseiId: string) => boolean;
  onAddDay: (senseiId: string, dateKey: string, weekday: number) => void;
  onDisableSlot: (id: string) => void;
}) {
  return (
    <div className="ui-card overflow-auto">
      <div className="min-w-[920px]">
        <div
          className="grid border-b border-line"
          style={{ gridTemplateColumns: '220px repeat(7, minmax(0, 1fr))' }}
        >
          <div className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
            Sensei
          </div>
          {days.map((day) => {
            const dateKey = toDateKey(day);
            const today = isToday(dateKey);
            return (
              <div
                key={dateKey}
                className={`border-l border-line px-2 py-3 text-center ${today ? 'bg-accent-soft' : ''}`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                  {format(day, 'EEE', { locale: localeId })}
                </div>
                <div className={`text-sm font-bold ${today ? 'text-accent' : 'text-ink'}`}>
                  {format(day, 'd')}
                </div>
              </div>
            );
          })}
        </div>

        {sensei.map((item) => {
          const weekAssigned = days.reduce((sum, day) => {
            const cap = getDayCapacity(item.id, toDateKey(day), availability, schedules);
            return sum + cap.assignedHours;
          }, 0);
          const weekAvailable = days.reduce((sum, day) => {
            const cap = getDayCapacity(item.id, toDateKey(day), availability, schedules);
            return sum + cap.availableHours;
          }, 0);
          const remaining = weekAvailable - weekAssigned;
          return (
            <div
              key={item.id}
              className="grid border-b border-line last:border-b-0"
              style={{ gridTemplateColumns: '220px repeat(7, minmax(0, 1fr))' }}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <Avatar name={item.name} size="sm" />
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{item.name}</div>
                  <div className={`text-xs font-semibold ${remaining < 0 ? 'text-danger' : 'text-ink-soft'}`}>
                    {weekAvailable > 0
                      ? `${formatHoursShort(weekAssigned)} / ${formatHoursShort(weekAvailable)} · sisa ${formatHoursShort(remaining)}`
                      : 'Belum buka slot'}
                  </div>
                  {jlptLevels(item.levels).length || item.canTeachEnglish || item.canTeachKids ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {jlptLevels(item.levels).map((level) => (
                        <Badge key={level} tone="muted">
                          {level}
                        </Badge>
                      ))}
                      {item.canTeachEnglish ? <Badge tone="sky">EN</Badge> : null}
                      {item.canTeachKids ? <Badge tone="sky">Kids</Badge> : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {days.map((day) => {
                const dateKey = toDateKey(day);
                const cap = getDayCapacity(item.id, dateKey, availability, schedules);
                const today = isToday(dateKey);
                const editable = canEdit(item.id);
                const closed = cap.availableHours <= 0;
                const over = cap.assignedHours > cap.availableHours && cap.availableHours > 0;
                const fill = cap.availableHours > 0 ? Math.min(cap.assignedHours / cap.availableHours, 1) : 0;
                return (
                  <div
                    key={`${item.id}-${dateKey}`}
                    className={`relative min-h-[108px] border-l border-line p-1.5 ${today ? 'bg-surface-2' : ''}`}
                  >
                    {!closed ? (
                      <div
                        className="absolute inset-x-1 bottom-1 rounded-md bg-surface-2"
                        style={{ height: 'calc(100% - 8px)' }}
                      />
                    ) : null}
                    {!closed && fill > 0 ? (
                      <div
                        className={`absolute inset-x-1 bottom-1 rounded-md transition-[height] duration-300 ${
                          over ? 'bg-danger/30' : 'bg-accent/30'
                        }`}
                        style={{ height: `calc((100% - 8px) * ${fill})` }}
                      />
                    ) : null}
                    <div className="relative z-10 flex h-full flex-col">
                      {closed ? (
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => onAddDay(item.id, dateKey, weekdayOf(dateKey))}
                          className="flex h-full min-h-[92px] w-full items-center justify-center rounded-md text-[11px] text-ink-soft disabled:cursor-default"
                        >
                          {editable ? '+ Buka' : '—'}
                        </button>
                      ) : (
                        <>
                          <div className="px-1 pt-1 text-[11px] font-semibold text-ink">
                            {cap.slots
                              .map((slot) => compactTimeRange(slot.startTime, slot.endTime))
                              .join(' · ')}
                          </div>
                          <div className="px-1 text-[10px] font-semibold text-ink-soft">
                            {formatHoursShort(cap.assignedHours)} / {formatHoursShort(cap.availableHours)}
                          </div>
                          <div className="mt-auto space-y-1 px-0.5 pb-0.5">
                            {cap.sessions.slice(0, 2).map((session) => (
                              <div
                                key={session.id}
                                className="truncate rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink"
                              >
                                {compactTimeRange(session.startTime, session.endTime)} {session.level}
                              </div>
                            ))}
                            {cap.sessions.length > 2 ? (
                              <div className="px-1 text-[10px] text-ink-soft">
                                +{cap.sessions.length - 2} sesi
                              </div>
                            ) : null}
                            {editable
                              ? cap.slots.map((slot) => (
                                  <button
                                    key={slot.id}
                                    type="button"
                                    className="block px-1 text-[10px] font-semibold text-ink-soft underline-offset-2 hover:text-danger hover:underline"
                                    onClick={() => onDisableSlot(slot.id)}
                                  >
                                    Nonaktifkan
                                  </button>
                                ))
                              : null}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CapacityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 rounded bg-surface-2" /> Tersedia
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 rounded bg-accent/30" /> Terisi jadwal resmi
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 rounded bg-danger/30" /> Overbook
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 rounded border border-dashed border-line" /> Tutup
      </span>
    </div>
  );
}
