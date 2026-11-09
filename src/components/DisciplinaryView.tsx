import { useMemo, useState } from 'react';
import { getDisciplinaryMetrics, monthKey, type DisciplinePeriod } from '../lib/disciplinary';
import { useDashboardStore, usePermissions } from '../store/useDashboardStore';
import { PageIntro } from './ui/PageIntro';
import { StatCard } from './ui/StatCard';

type SortKey = 'swaps' | 'cancels' | 'late';

export function DisciplinaryView() {
  const permissions = usePermissions();
  const currentUser = useDashboardStore((state) => state.currentUser);
  const sensei = useDashboardStore((state) => state.sensei);
  const schedules = useDashboardStore((state) => state.schedules);
  const logs = useDashboardStore((state) => state.sessionLogs);
  const [mode, setMode] = useState<'month' | 'range'>('month');
  const [month, setMonth] = useState(monthKey(new Date()));
  const [range, setRange] = useState({ from: '', to: '' });
  const rangeInvalid = Boolean(range.from && range.to && range.from > range.to);
  const period: DisciplinePeriod = mode === 'month' ? month || monthKey(new Date()) : range;
  const periodLabel = mode === 'month' ? month : `${range.from || 'awal'} s/d ${range.to || 'sekarang'}`;
  const [sortKey, setSortKey] = useState<SortKey>('swaps');

  const visible = permissions.canViewAllSensei
    ? sensei.filter((item) => item.primaryStatus === 'ACTIVE')
    : sensei.filter((item) => item.id === currentUser?.senseiId);

  const rows = useMemo(() => {
    const mapped = visible.map((item) => ({
      sensei: item,
      metrics: getDisciplinaryMetrics(
        item.id,
        // An inverted range matches nothing instead of silently showing everything.
        rangeInvalid ? { from: '9999-12-31', to: '0000-01-01' } : period,
        schedules,
        logs
      )
    }));
    const weight = (m: (typeof mapped)[number]['metrics']) =>
      sortKey === 'swaps'
        ? m.senseiInitiatedSwaps
        : sortKey === 'cancels'
          ? m.cancelledNoReplacement
          : m.lateJoins;
    return mapped.sort(
      (a, b) =>
        weight(b.metrics) - weight(a.metrics) ||
        b.metrics.senseiInitiatedSwaps +
          b.metrics.cancelledNoReplacement +
          b.metrics.lateJoins -
          (a.metrics.senseiInitiatedSwaps + a.metrics.cancelledNoReplacement + a.metrics.lateJoins)
    );
  }, [visible, period, rangeInvalid, schedules, logs, sortKey]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          swaps: acc.swaps + row.metrics.senseiInitiatedSwaps,
          cancels: acc.cancels + row.metrics.cancelledNoReplacement,
          late: acc.late + row.metrics.lateJoins
        }),
        { swaps: 0, cancels: 0, late: 0 }
      ),
    [rows]
  );

  const header = (key: SortKey, label: string) => (
    <th className="num">
      <button
        type="button"
        onClick={() => setSortKey(key)}
        className={`inline-flex items-center gap-1 uppercase tracking-[inherit] ${
          sortKey === key ? 'text-ink' : ''
        }`}
      >
        {label} {sortKey === key ? '↓' : ''}
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      <PageIntro kicker="Disiplin" title={`Disiplin · ${periodLabel}`}>
        Metrik disiplin ditampilkan terpisah, belum digabung ke skor QA. Swap yang diminta siswa/admin tidak
        dihitung ke Sensei. Pembatalan tanpa pengganti hanya dihitung jika initiator Sensei.
      </PageIntro>

      <div className="ui-card flex flex-wrap items-end gap-3 p-3">
        <label>
          <span className="ui-label">Periode</span>
          <select
            className="ui-select"
            value={mode}
            onChange={(event) => setMode(event.target.value as 'month' | 'range')}
          >
            <option value="month">Per bulan</option>
            <option value="range">Rentang tanggal</option>
          </select>
        </label>
        {mode === 'month' ? (
          <label>
            <span className="ui-label">Bulan</span>
            <input
              className="ui-input"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
        ) : (
          <>
            <label>
              <span className="ui-label">Dari tanggal</span>
              <input
                className="ui-input"
                type="date"
                value={range.from}
                onChange={(event) => setRange({ ...range, from: event.target.value })}
              />
            </label>
            <label>
              <span className="ui-label">Sampai tanggal</span>
              <input
                className="ui-input"
                type="date"
                value={range.to}
                onChange={(event) => setRange({ ...range, to: event.target.value })}
              />
            </label>
          </>
        )}
        {rangeInvalid ? (
          <p className="text-sm text-danger">Tanggal awal harus sebelum tanggal akhir.</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Swap inisiatif Sensei"
          value={totals.swaps}
          hint="periode terpilih, seluruh Sensei"
        />
        <StatCard label="Cancel tanpa pengganti" value={totals.cancels} hint="initiator Sensei" />
        <StatCard label="Late join" value={totals.late} hint="grace default 0 menit" />
      </div>

      <div className="ui-card overflow-hidden">
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Sensei</th>
                {header('swaps', 'Swap Sensei')}
                {header('cancels', 'Cancel tanpa pengganti')}
                {header('late', 'Late join')}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="text-ink-soft" colSpan={4}>
                    Tidak ada Sensei aktif.
                  </td>
                </tr>
              ) : (
                rows.map(({ sensei: item, metrics }) => (
                  <tr key={item.id}>
                    <td className="font-medium text-ink">{item.name}</td>
                    <td
                      className={`num ${metrics.senseiInitiatedSwaps ? 'font-semibold text-ink' : 'text-ink-soft'}`}
                    >
                      {metrics.senseiInitiatedSwaps}
                    </td>
                    <td
                      className={`num ${
                        metrics.cancelledNoReplacement ? 'font-semibold text-danger' : 'text-ink-soft'
                      }`}
                    >
                      {metrics.cancelledNoReplacement}
                    </td>
                    <td className={`num ${metrics.lateJoins ? 'font-semibold text-warn' : 'text-ink-soft'}`}>
                      {metrics.lateJoins}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
