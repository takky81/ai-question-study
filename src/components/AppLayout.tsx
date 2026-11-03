import { Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { NavLinks, type NavItem } from './NavLinks';

const APP_NAME = 'AI 問題学習';
const FALLBACK_ERROR = 'ログアウトに失敗しました。時間をおいて再度お試しください。';

type Props = { navItems: readonly NavItem[]; onSignOut: () => Promise<void> };

/**
 * 保護ルート共通のレイアウト。導線とログアウト処理は props で受け取り、業務データは取得しない。
 * PC 幅（lg 以上）はサイドナビとヘッダーのログアウト、モバイル幅は下部の学習導線とメニューを使う（5.2、5.3、5.4）。
 */
export function AppLayout({ navItems, onSignOut }: Props): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const learnItems = navItems.filter((i) => i.group === 'learn');
  const manageItems = navItems.filter((i) => i.group === 'manage');

  // 導線を選んで画面が変わったらメニューを閉じる
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Escape でメニューを閉じ、フォーカスをメニューボタンへ戻す
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await onSignOut();
      navigate('/login', { replace: true });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : FALLBACK_ERROR);
      setSigningOut(false);
    }
  }

  const logoutButton = (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={signingOut}
      className="tap-target focus-ring rounded border border-border px-3 py-2 text-text disabled:opacity-60"
    >
      ログアウト
    </button>
  );

  return (
    <div className="flex min-h-dvh min-w-0 flex-col bg-bg text-text">
      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        <div className="flex min-w-0 items-center justify-between gap-2 px-4 py-2">
          <Link to="/" className="tap-target focus-ring flex min-w-0 items-center rounded font-bold break-words">
            {APP_NAME}
          </Link>
          <div className="hidden lg:flex">{logoutButton}</div>
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="メニュー"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((o) => !o)}
            className="tap-target focus-ring flex items-center justify-center rounded lg:hidden"
          >
            {menuOpen ? <X aria-hidden="true" className="size-6" /> : <Menu aria-hidden="true" className="size-6" />}
          </button>
        </div>
        {menuOpen && (
          <div id={menuId} className="flex min-w-0 flex-col gap-4 border-t border-border px-4 py-3 lg:hidden">
            {manageItems.length > 0 && (
              <nav aria-label="管理メニュー" className="min-w-0">
                <NavLinks items={manageItems} variant="menu" />
              </nav>
            )}
            <div>{logoutButton}</div>
          </div>
        )}
        {error && (
          <p role="alert" className="border-t border-border px-4 py-2 text-warn break-words">
            {error}
          </p>
        )}
      </header>
      <div className="flex min-w-0 flex-1">
        <nav aria-label="サイドナビゲーション" className="hidden w-60 shrink-0 border-r border-border p-4 lg:block">
          <NavLinks items={navItems} variant="sidebar" />
        </nav>
        <main className={`min-w-0 flex-1 p-4 ${learnItems.length > 0 ? 'pb-24 lg:pb-4' : ''}`}>
          <Outlet />
        </main>
      </div>
      {learnItems.length > 0 && (
        <nav
          aria-label="学習ナビゲーション"
          className="fixed inset-x-0 bottom-0 z-20 min-w-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <NavLinks items={learnItems} variant="bottom" />
        </nav>
      )}
    </div>
  );
}
