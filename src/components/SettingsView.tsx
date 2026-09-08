import { useEffect, useState } from 'react';
import { useTheme } from '../lib/theme';
import { useDashboardStore, usePermissions } from '../store/useDashboardStore';
import { Button } from './ui/Button';
import { PageIntro } from './ui/PageIntro';

export function SettingsView() {
  const permissions = usePermissions();
  const settings = useDashboardStore((state) => state.settings);
  const updateSettings = useDashboardStore((state) => state.updateSettings);
  const { theme, setTheme } = useTheme();
  const [grace, setGrace] = useState(String(settings.lateGraceMinutes));
  const [hourTarget, setHourTarget] = useState(String(settings.weeklyHourTarget));

  useEffect(() => {
    setGrace(String(settings.lateGraceMinutes));
  }, [settings.lateGraceMinutes]);

  useEffect(() => {
    setHourTarget(String(settings.weeklyHourTarget));
  }, [settings.weeklyHourTarget]);

  if (!permissions.canManageUsers && permissions.role !== 'Super Admin') {
    return <p className="text-sm text-ink-soft">Hanya Super Admin yang dapat mengubah pengaturan.</p>;
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageIntro kicker="Pengaturan" title="Pengaturan operasional">
        Grace late-join dihitung dari jam mulai kelas di timezone Sensei pengajar (WIB / WITA / WIT / JST),
        bukan dari zona browser atau paksa WIB.
      </PageIntro>

      <section className="ui-card space-y-3 p-5">
        <div>
          <p className="ui-label">Tampilan</p>
          <p className="mt-1 text-xs text-ink-soft">
            Tema disimpan di perangkat ini. Tidak mengubah data operasional.
          </p>
        </div>
        <div className="flex gap-2">
          <Button tone={theme === 'light' ? 'primary' : 'secondary'} onClick={() => setTheme('light')}>
            Terang
          </Button>
          <Button tone={theme === 'dark' ? 'primary' : 'secondary'} onClick={() => setTheme('dark')}>
            Gelap
          </Button>
        </div>
      </section>

      <section className="ui-card space-y-3 p-5">
        <div>
          <p className="ui-label">Grace late-join (menit)</p>
          <p className="mt-1 text-xs text-ink-soft">
            Clock-in lebih dari N menit setelah jam mulai kelas (zona Sensei) ditandai terlambat. Isi 0 untuk
            tanpa toleransi.
          </p>
        </div>
        <input
          className="ui-input max-w-[140px]"
          type="number"
          min={0}
          max={120}
          step={1}
          value={grace}
          onChange={(event) => setGrace(event.target.value)}
        />
        <div>
          <Button
            onClick={() => {
              const parsed = Number(grace);
              if (!Number.isFinite(parsed) || parsed < 0) return;
              updateSettings({ lateGraceMinutes: Math.floor(parsed) });
            }}
          >
            Simpan grace
          </Button>
        </div>
        <p className="text-xs text-ink-soft">Nilai aktif sekarang: {settings.lateGraceMinutes} menit</p>
      </section>

      <section className="ui-card space-y-3 p-5">
        <div>
          <p className="ui-label">Target jam mengajar / minggu</p>
          <p className="mt-1 text-xs text-ink-soft">
            Dasar hitung beban kerja Sensei — bar &ldquo;X / Y jam&rdquo; di menu Sensei, filter
            &ldquo;Di bawah target jam&rdquo;, dan peringatan under-utilized di Action Center. Berlaku untuk
            semua Sensei.
          </p>
        </div>
        <input
          className="ui-input max-w-[140px]"
          type="number"
          min={1}
          max={80}
          step={1}
          value={hourTarget}
          onChange={(event) => setHourTarget(event.target.value)}
        />
        <div>
          <Button
            onClick={() => {
              const parsed = Number(hourTarget);
              if (!Number.isFinite(parsed) || parsed < 1) return;
              updateSettings({ weeklyHourTarget: Math.floor(parsed) });
            }}
          >
            Simpan target
          </Button>
        </div>
        <p className="text-xs text-ink-soft">Nilai aktif sekarang: {settings.weeklyHourTarget} jam / minggu</p>
      </section>
    </div>
  );
}
