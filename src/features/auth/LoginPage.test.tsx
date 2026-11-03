import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// supabase.ts は読み込み時に環境変数を検証するため、通信しないモックに差し替える。
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth } }));

import { AuthProvider } from './AuthProvider';
import { LoginPage } from './LoginPage';

const session = { user: { id: 'u1', email: 'owner@example.com' } };

function Probe() {
  const location = useLocation();
  return <p data-testid="dest">{location.pathname + location.search}</p>;
}

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  auth.getSession.mockReset();
  auth.onAuthStateChange.mockReset();
  auth.signInWithPassword.mockReset();
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
});

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('メールアドレス'), 'owner@example.com');
  await user.type(screen.getByLabelText('パスワード'), 'wrong-pass');
  await user.click(screen.getByRole('button', { name: 'ログイン' }));
}

describe('LoginPage', () => {
  it('セッションの確認中はフォームを出さず読み込み表示だけを出す', () => {
    auth.getSession.mockReturnValue(new Promise(() => {}));
    renderAt('/login');
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument();
  });

  it('ラベル付きの入力欄と autocomplete を持ち、登録の導線を置かない', async () => {
    renderAt('/login');
    const email = await screen.findByLabelText('メールアドレス');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('パスワード')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/登録|サインアップ|アカウント作成/)).not.toBeInTheDocument();
  });

  it('送信中はボタンを無効化して進行中表示を出す', async () => {
    auth.signInWithPassword.mockReturnValue(new Promise(() => {}));
    renderAt('/login');
    await fillAndSubmit();
    const button = await screen.findByRole('button', { name: 'ログイン中…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('失敗時は入力を保持したままエラーを読み上げ可能な形で表示する', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { status: 400, code: 'invalid_credentials', message: 'x' },
    });
    renderAt('/login');
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'メールアドレスまたはパスワードが正しくありません',
    );
    expect(screen.getByLabelText('メールアドレス')).toHaveValue('owner@example.com');
    expect(screen.getByLabelText('パスワード')).toHaveValue('wrong-pass');
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeEnabled();
  });

  it('成功時は検証済みの redirect へ遷移する', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
    renderAt(`/login?redirect=${encodeURIComponent('/questions?tag=a')}`);
    await fillAndSubmit();
    expect(await screen.findByTestId('dest')).toHaveTextContent('/questions?tag=a');
  });

  it('成功時、外部ホストの redirect は拒否してホームへ遷移する', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
    renderAt(`/login?redirect=${encodeURIComponent('//evil.example')}`);
    await fillAndSubmit();
    expect(await screen.findByTestId('dest')).toHaveTextContent(/^\/$/);
  });

  it('ログイン済みで開いた場合は redirect（なければホーム）へ遷移する', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    renderAt(`/login?redirect=${encodeURIComponent('/history')}`);
    expect(await screen.findByTestId('dest')).toHaveTextContent('/history');
  });

  it('ログイン済みで redirect なしならホームへ遷移する', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    renderAt('/login');
    expect(await screen.findByTestId('dest')).toHaveTextContent(/^\/$/);
  });
});
