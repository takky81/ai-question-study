// 保護ルートのガード。確認中は内容を出さず、未ログインなら元のパスを保持してログイン画面へ置換遷移する。
import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';
import { buildLoginPath } from './redirect';

export function RequireAuth(): ReactElement {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return (
      <p role="status" className="p-4">
        読み込み中…
      </p>
    );
  }
  if (auth.status === 'signedOut') {
    const current = location.pathname + location.search + location.hash;
    return <Navigate replace to={buildLoginPath(current)} />;
  }
  return <Outlet />;
}
