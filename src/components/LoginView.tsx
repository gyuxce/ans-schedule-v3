import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { isSupabaseConfigured } from '../lib/supabase';
import { useDashboardStore } from '../store/useDashboardStore';
import { ThemeToggle } from './layout/ThemeToggle';
import { Button } from './ui/Button';
import { PasswordField } from './ui/PasswordField';

export function LoginView() {
  const configured = isSupabaseConfigured();
  const signInWithEmail = useDashboardStore((state) => state.signInWithEmail);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="text-lg font-bold tracking-tight text-ink">ANS Dashboard</div>
          <div className="text-xs text-ink-soft">Operasional &amp; akademik</div>
        </div>

        <div className="ui-panel p-6">
          {!configured ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
                Konfigurasi diperlukan
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">Layanan belum terhubung</h2>
              <p className="mt-2 text-sm leading-6 text-ink-soft">
                Hubungi admin operasional untuk memastikan environment aplikasi sudah dikonfigurasi.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-ink">Masuk</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Gunakan email &amp; password akun yang sudah disetujui admin.
              </p>
              <form
                className="mt-6 space-y-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setLoading(true);
                  await signInWithEmail(email, password);
                  setLoading(false);
                }}
              >
                <label className="block">
                  <span className="ui-label">Email</span>
                  <input
                    className="ui-input"
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="ui-label">Password</span>
                  <PasswordField
                    value={password}
                    onChange={setPassword}
                    required
                    autoComplete="current-password"
                  />
                </label>
                <Button tone="primary" className="mt-1 h-10 w-full" disabled={loading}>
                  {loading ? <Loader2 className="animate-spin" size={16} /> : null}
                  Masuk
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-soft">
          Masuk dengan akun resmi yang sudah diaktifkan.
        </p>
      </div>
    </div>
  );
}
