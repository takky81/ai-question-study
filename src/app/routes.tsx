// ルート登録表。後続 spec はここに1行追加するだけで画面と導線を組み込む（1.4）。
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

// NavGroup は共通部品側（src/components/NavLinks.tsx）で定義し、ここでは import して再 export する。
import type { NavGroup, NavItem } from '../components/NavLinks';
import { LoginPage } from '../features/auth/LoginPage';
import { HomePage } from '../features/home/HomePage';

export type { NavGroup };

export type AppRoute = {
  /** basename からの相対パス。例: 'quiz'。ホームは '' */
  path: string;
  element: ReactElement;
  /** 既定 false（保護ルートとして RequireAuth 配下・AppLayout 内に置く）（4.5） */
  public?: boolean;
  /** 導線メタデータ。持つルートだけが導線に現れる（5.6） */
  nav?: {
    /** 日本語の表示名 */
    label: string;
    /** learn: 出題・統計、manage: カタログ・入出力 */
    group: NavGroup;
    icon: LucideIcon;
    /** 区分内の表示順 */
    order: number;
  };
};

export const APP_ROUTES: readonly AppRoute[] = [
  // ホームは導線なし。ヘッダーのアプリ名がホームへのリンクになる（5.1）
  { path: '', element: <HomePage /> },
  { path: 'login', element: <LoginPage />, public: true },
];

/** nav を持つルートだけを、表示順（同順位は登録順）で導線項目にする（5.6）。 */
export function toNavItems(routes: readonly AppRoute[]): NavItem[] {
  return routes
    .flatMap((r) => (r.nav ? [{ path: `/${r.path}`, ...r.nav }] : []))
    .sort((a, b) => a.order - b.order);
}
