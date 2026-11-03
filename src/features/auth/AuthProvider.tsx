// 認証状態の Provider。起動時にセッションを復元し、以後の変化（他タブでのログアウト、失効、更新）を購読する。
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedIn'; userId: string; email: string }
  | { status: 'signedOut' };

const AuthContext = createContext<AuthState>({ status: 'loading' });

function toAuthState(session: Session | null): AuthState {
  if (!session) return { status: 'signedOut' };
  return { status: 'signedIn', userId: session.user.id, email: session.user.email ?? '' };
}

export function AuthProvider(props: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    // 購読を先に始め、復元より後に届いた通知を取りこぼさないようにする。
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState(toAuthState(session));
    });
    supabase.auth
      .getSession()
      .then(({ data: restored }) => {
        if (active) setState(toAuthState(restored.session));
      })
      .catch(() => {
        // 復元に失敗した場合は未ログインとして扱い、ログイン画面へ誘導する。
        if (active) setState({ status: 'signedOut' });
      });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
