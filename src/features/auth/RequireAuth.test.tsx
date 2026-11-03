import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// supabase.ts は読み込み時に環境変数を検証するため、通信しないモックに差し替える。
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth } }));

import { AuthProvider } from './AuthProvider';
import { RequireAuth } from './RequireAuth';

type Listener = (event: string, session: unknown) => void;

const session = { user: { id: 'u1', email: 'owner@example.com' } };
let listener: Listener | undefined;
const unsubscribe = vi.fn();

function LoginProbe() {
  const location = useLocation();
  return <p data-testid="login">{location.pathname + location.search}</p>;
}

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<RequireAuth />}>
            <Route path="/questions" element={<p>保護された内容</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  listener = undefined;
  unsubscribe.mockReset();
  auth.getSession.mockReset();
  auth.onAuthStateChange.mockReset();
  auth.onAuthStateChange.mockImplementation((cb: Listener) => {
    listener = cb;
    return { data: { subscription: { unsubscribe } } };
  });
});

describe('RequireAuth', () => {
  it('確認中は読み込み表示だけを出し、子を描画しない', () => {
    auth.getSession.mockReturnValue(new Promise(() => {}));
    renderAt('/questions');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('保護された内容')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
  });

  it('未ログインなら元のパス（クエリとハッシュ含む）を保持してログイン画面へ遷移する', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    renderAt('/questions?tag=a#top');
    const login = await screen.findByTestId('login');
    expect(login).toHaveTextContent(
      `/login?redirect=${encodeURIComponent('/questions?tag=a#top')}`,
    );
    expect(screen.queryByText('保護された内容')).not.toBeInTheDocument();
  });

  it('保存済みセッションを復元できればログイン済みとして子を描画する', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    renderAt('/questions');
    expect(await screen.findByText('保護された内容')).toBeInTheDocument();
  });

  it('他タブでのログアウトや失効で未ログインになると、ログイン画面へ遷移する', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    renderAt('/questions');
    await screen.findByText('保護された内容');
    act(() => listener?.('SIGNED_OUT', null));
    expect(await screen.findByTestId('login')).toHaveTextContent(
      `/login?redirect=${encodeURIComponent('/questions')}`,
    );
  });

  it('アンマウント時に購読を解除する', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const { unmount } = renderAt('/questions');
    await screen.findByTestId('login');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
