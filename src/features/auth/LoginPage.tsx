// ログイン画面。登録の導線は置かない。成功時とログイン済みで開いた場合は検証済みの遷移先へ置換遷移する。
import { useState, type FormEvent, type ReactElement } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { signIn } from './api';
import { useAuth } from './AuthProvider';
import { resolveRedirect } from './redirect';

const INPUT_CLASS =
  'tap-target focus-ring w-full rounded-md border border-border bg-surface px-3 text-base text-text';

export function LoginPage(): ReactElement {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const destination = resolveRedirect(searchParams.get('redirect'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // セッション復元中にフォームを出すと、ログイン済みの利用者に一瞬フォームが見えるため待つ。
  if (auth.status === 'loading') {
    return (
      <p role="status" className="p-4">
        読み込み中…
      </p>
    );
  }

  if (auth.status === 'signedIn' && !submitting) {
    return <Navigate replace to={destination} />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await signIn({ email, password });
      navigate(destination, { replace: true });
    } catch (caught) {
      // 入力値は保持したまま、エラーだけを表示する。
      setError(caught instanceof Error ? caught.message : String(caught));
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-start justify-center bg-bg px-4 py-12 text-text sm:items-center">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-surface p-6"
      >
        <h1 className="text-xl font-bold">ログイン</h1>
        <div className="space-y-1">
          <label htmlFor="login-email" className="block font-medium">
            メールアドレス
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={error ? 'login-error' : undefined}
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="login-password" className="block font-medium">
            パスワード
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={error ? 'login-error' : undefined}
            className={INPUT_CLASS}
          />
        </div>
        {/* role="alert" 自体が読み上げ領域なので、外側に aria-live を重ねない（二重読み上げを防ぐ）。 */}
        {error && (
          <p
            id="login-error"
            role="alert"
            className="rounded-md border border-warn px-3 py-2 font-medium text-warn"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="tap-target focus-ring w-full rounded-md bg-primary px-4 font-bold text-surface disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
    </main>
  );
}
