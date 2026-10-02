import { useState } from 'react';
import { formatDateTime } from '../lib/dates';
import { displayName } from '../lib/display';
import { useDashboardStore, usePermissions, useScopedData } from '../store/useDashboardStore';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { PageIntro } from './ui/PageIntro';

const QA_SCORE_OPTIONS = [
  { value: 3, label: 'Above Expectation' },
  { value: 2, label: 'Meet Expectation' },
  { value: 1, label: 'Below Expectation' }
] as const;

function qaScoreLabel(score: number) {
  if (score >= 3) return 'Above Expectation';
  if (score === 2) return 'Meet Expectation';
  return 'Below Expectation';
}

export function QaView() {
  const permissions = usePermissions();
  const allSensei = useDashboardStore((state) => state.sensei);
  const allUsers = useDashboardStore((state) => state.users);
  const upsertQaScore = useDashboardStore((state) => state.upsertQaScore);
  const reviewRecording = useDashboardStore((state) => state.reviewRecording);
  const { qaScores, sessionReports, schedules, sensei } = useScopedData();
  const month = new Date().toISOString().slice(0, 7);
  const [scoreForm, setScoreForm] = useState({
    senseiId: sensei[0]?.id ?? allSensei[0]?.id ?? '',
    score: 2,
    notes: ''
  });
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const recordings = sessionReports
    .map((report) => ({
      report,
      session: schedules.find((item) => item.id === report.scheduleId)
    }))
    .filter((item) => item.session)
    .sort((a, b) =>
      `${b.session!.date}T${b.session!.startTime}`.localeCompare(`${a.session!.date}T${a.session!.startTime}`)
    );

  return (
    <div className="space-y-6">
      <PageIntro kicker="QA & Rekaman" title="QA & rekaman">
        Teaching Performance dinilai manual oleh Kyouiku (Above/Meet/Below Expectation). Rekaman disimpan sebagai
        referensi URL. Skor komposit disiplin belum digabung di V3.
      </PageIntro>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="ui-card overflow-hidden">
          <h3 className="p-4 pb-0 font-semibold">Skor Teaching Performance</h3>
          <div className="ui-table-wrap mt-3">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Sensei</th>
                  <th>Bulan</th>
                  <th className="num">Skor</th>
                </tr>
              </thead>
              <tbody>
                {qaScores.length === 0 ? (
                  <tr>
                    <td className="text-ink-soft" colSpan={3}>
                      Belum ada skor.
                    </td>
                  </tr>
                ) : (
                  qaScores.map((item) => (
                    <tr key={item.id}>
                      <td className="text-ink">{displayName(allSensei, item.senseiId)}</td>
                      <td className="text-ink-soft">{item.month}</td>
                      <td className="num font-semibold text-ink">{qaScoreLabel(item.score)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {permissions.canEditQa ? (
            <div className="m-4 mt-3 space-y-2 rounded-xl border border-line bg-surface-2 p-3">
              <select
                className="ui-select"
                value={scoreForm.senseiId}
                onChange={(event) => setScoreForm({ ...scoreForm, senseiId: event.target.value })}
              >
                {(permissions.canViewAllSensei ? allSensei : sensei)
                  .filter((item) => item.primaryStatus === 'ACTIVE')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
              <select
                className="ui-select"
                value={scoreForm.score}
                onChange={(event) => setScoreForm({ ...scoreForm, score: Number(event.target.value) })}
              >
                {QA_SCORE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="ui-input"
                placeholder="Catatan QA"
                value={scoreForm.notes}
                onChange={(event) => setScoreForm({ ...scoreForm, notes: event.target.value })}
              />
              <Button
                tone="primary"
                onClick={() => upsertQaScore(scoreForm.senseiId, month, scoreForm.score, scoreForm.notes)}
              >
                Simpan skor {month}
              </Button>
            </div>
          ) : (
            <p className="m-4 mt-3 text-xs text-ink-soft">
              Menampilkan skor Teaching Performance milik akun Sensei yang login.
            </p>
          )}
        </div>
        <div className="ui-card p-4">
          <h3 className="font-semibold">Referensi rekaman</h3>
          <div className="mt-3 space-y-2">
            {recordings.map(({ report, session }) => (
              <div key={report.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">
                    {session?.level} · {displayName(allSensei, session?.senseiId)} · {session?.date}
                  </div>
                  <Badge
                    tone={
                      report.recordingStatus === 'Available'
                        ? 'success'
                        : report.recordingStatus === 'Missing'
                          ? 'danger'
                          : 'muted'
                    }
                  >
                    {report.recordingStatus}
                  </Badge>
                </div>
                {report.recordingUrl ? (
                  <a
                    className="break-all text-xs font-semibold text-accent underline"
                    href={report.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {report.recordingUrl}
                  </a>
                ) : (
                  <p className="text-xs text-ink-soft">Belum ada URL</p>
                )}
                <div className="mt-1 flex items-center justify-between">
                  <Badge tone={report.qaReviewStatus === 'Reviewed' ? 'pine' : 'gold'}>
                    {report.qaReviewStatus}
                  </Badge>
                  {permissions.canReviewQa && report.recordingStatus === 'Available' ? (
                    <button
                      className="text-xs font-semibold text-accent"
                      onClick={() => {
                        setReviewId(report.id);
                        setReviewNotes(report.qaReviewNotes ?? '');
                      }}
                    >
                      Review
                    </button>
                  ) : null}
                </div>
                {report.qaReviewedAt ? (
                  <p className="mt-1 text-xs text-ink-soft">
                    {displayName(allUsers, report.qaReviewerId)} · {formatDateTime(report.qaReviewedAt)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
      {reviewId ? (
        <Modal
          title="Review rekaman"
          onClose={() => setReviewId(null)}
          footer={
            <>
              <Button onClick={() => setReviewId(null)}>Batal</Button>
              <Button
                tone="primary"
                onClick={() => {
                  reviewRecording(reviewId, reviewNotes);
                  setReviewId(null);
                }}
              >
                Tandai reviewed
              </Button>
            </>
          }
        >
          <textarea
            className="ui-textarea"
            value={reviewNotes}
            onChange={(event) => setReviewNotes(event.target.value)}
            placeholder="Catatan review Kyouiku"
          />
        </Modal>
      ) : null}
    </div>
  );
}
