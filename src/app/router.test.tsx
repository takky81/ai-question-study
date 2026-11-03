import { act, render, screen } from '@testing-library/react';
import { Circle, Square } from 'lucide-react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// supabase.ts は読み込み時に環境変数を検証するため、通信しないモックに差し替える。
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth } }));

import { AuthProvider } from '../features/auth/AuthProvider';
import { buildRouteObjects, toBasename } from './router';
import { APP_ROUTES, toNavItems, type AppRoute } from './routes';

// jsdom の AbortSignal は Node の Request が受け付けないため、データルーターの遷移用に signal を外す。
class TestRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const { signal: _signal, ...rest } = init ?? {};
    super(input, rest);
  }
}
vi.stubGlobal('Request', TestRequest);

const session = { user: { id: 'u1', email: 'owner@example.com' } };

function Boom(): never {
  throw new Error('描画失敗');
}

const TEST_ROUTES: readonly AppRoute[] = [
  ...APP_ROUTES,
  { path: 'b', element: <p>B画面</p>, nav: { label: 'B', group: 'learn', icon: Square, order: 2 } },
  { path: 'a', element: <p>A画面</p>, nav: { label: 'A', group: 'learn', icon: Circle, order: 1 } },
  { path: 'm', element: <p>M画面</p>, nav: { label: 'M', group: 'manage', icon: Circle, order: 1 } },
  { path: 'boom', element: <Boom /> },
];

async function renderAt(path: string, signedIn: boolean, routes: readonly AppRoute[] = TEST_ROUTES) {
  auth.getSession.mockResolvedValue({ data: { session: signedIn ? session : null } });
  const router = createMemoryRouter(buildRouteObjects(routes), { initialEntries: [path] });
  await act(async () => {
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
  });
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});

describe('toNavItems', () => {
  it('nav を持つルートだけを区分内の表示順で導線項目にする（5.6）', () => {
    const items = toNavItems(TEST_ROUTES.slice(APP_ROUTES.length));
    expect(items.map((i) => [i.path, i.label, i.group, i.order])).toEqual([
      ['/a', 'A', 'learn', 1],
      ['/m', 'M', 'manage', 1],
      ['/b', 'B', 'learn', 2],
    ]);
  });

  it('ホームとログインは導線を作らない（後続 spec の行は追加のみ）', () => {
    const navPaths = toNavItems(APP_ROUTES).map((i) => i.path);
    expect(navPaths).not.toContain('/');
    expect(navPaths).not.toContain('/login');
    expect(APP_ROUTES.slice(0, 2).map((r) => [r.path, r.public ?? false, r.nav])).toEqual([
      ['', false, undefined],
      ['login', true, undefined],
    ]);
  });
});

describe('出題のルート（quiz-session 10.1）', () => {
  it('範囲選択画面は学習区分の「出題」導線を持ち、解答画面は導線を持たず、どちらも保護ルートである', () => {
    const quiz = APP_ROUTES.find((r) => r.path === 'quiz');
    const play = APP_ROUTES.find((r) => r.path === 'quiz/play');
    expect(quiz?.public ?? false).toBe(false);
    expect(play?.public ?? false).toBe(false);
    expect(play).toBeDefined();
    expect(play?.nav).toBeUndefined();
    expect(quiz?.nav).toMatchObject({ label: '出題', group: 'learn', order: 1 });
    expect(toNavItems(APP_ROUTES).filter((i) => i.group === 'learn').map((i) => i.path)).toEqual(['/quiz']);
  });

  it('未ログインで出題画面を開くとログイン画面へ遷移する', async () => {
    const router = await renderAt('/quiz', false, APP_ROUTES);
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('toBasename', () => {
  it('BASE_URL の末尾 / を除き、ルート配信時は / とする（2.1、2.2）', () => {
    expect(toBasename('/ai-question-study/')).toBe('/ai-question-study');
    expect(toBasename('/')).toBe('/');
    expect(toBasename('/repo')).toBe('/repo');
  });
});

describe('ルーター構成', () => {
  it('未ログインで保護ルートを開くとログイン画面へ遷移する（4.5）', async () => {
    const router = await renderAt('/', false);
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('ログイン画面は共通レイアウトの外に置かれる', async () => {
    await renderAt('/login', false);
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument();
  });

  it('ログイン後は空のホームが共通レイアウト内に表示され、導線が渡される（5.1）', async () => {
    await renderAt('/', true);
    expect(screen.getByRole('heading', { level: 1, name: 'ホーム' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'ログアウト' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'A' }).length).toBeGreaterThan(0);
  });

  it('登録表の導線は nav を持つ行だけから作られ、学習区分に「出題」が出る（5.6、quiz-session 10.1）', async () => {
    await renderAt('/', true, APP_ROUTES);
    expect(screen.queryByRole('navigation', { name: 'サイドナビゲーション' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: '学習' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: '出題' })[0]).toHaveAttribute('href', '/quiz');
  });

  it('存在しない URL ではホームへの導線付きの 404 画面を表示する（2.4）', async () => {
    await renderAt('/no/such/page', false);
    expect(screen.getByRole('heading', { name: 'ページが見つかりません' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ホームへ戻る' })).toHaveAttribute('href', '/');
  });

  it('描画時の例外ではエラー画面とホームへの導線を表示する', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderAt('/boom', true);
    expect(screen.getByRole('heading', { name: '問題が発生しました' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ホームへ戻る' })).toBeInTheDocument();
    spy.mockRestore();
  });
});
