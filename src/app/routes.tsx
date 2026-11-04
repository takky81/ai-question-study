// ルート登録表。後続 spec はここに1行追加するだけで画面と導線を組み込む（1.4）。
import { ArrowLeftRight, BarChart3, FolderTree, GraduationCap, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

// NavGroup は共通部品側（src/components/NavLinks.tsx）で定義し、ここでは import して再 export する。
import type { NavGroup, NavItem } from '../components/NavLinks';
import { CatalogPage } from '../features/catalog/CatalogPage';
import { QuestionEditPage } from '../features/catalog/QuestionEditPage';
import { ExchangePage } from '../features/exchange/ExchangePage';
import { LoginPage } from '../features/auth/LoginPage';
import { HomePage } from '../features/home/HomePage';
import { QuizPlayPage } from '../features/quiz/QuizPlayPage';
import { QuizStartPage } from '../features/quiz/QuizStartPage';
import { StatsPage } from '../features/stats/StatsPage';

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
  { path: 'catalog', element: <CatalogPage />, nav: { label: 'カタログ', group: 'manage', icon: FolderTree, order: 1 } },
  { path: 'catalog/:subjectId', element: <CatalogPage /> },
  { path: 'catalog/:subjectId/questions/new', element: <QuestionEditPage /> },
  { path: 'catalog/:subjectId/questions/:questionId', element: <QuestionEditPage /> },
  { path: 'exchange', element: <ExchangePage />, nav: { label: '入出力', group: 'manage', icon: ArrowLeftRight, order: 2 } },
  { path: 'quiz', element: <QuizStartPage />, nav: { label: '出題', group: 'learn', icon: GraduationCap, order: 1 } },
  { path: 'stats', element: <StatsPage />, nav: { label: '統計', group: 'learn', icon: BarChart3, order: 2 } },
  { path: 'quiz/play', element: <QuizPlayPage /> },
];

/** nav を持つルートだけを、表示順（同順位は登録順）で導線項目にする（5.6）。 */
export function toNavItems(routes: readonly AppRoute[]): NavItem[] {
  return routes
    .flatMap((r) => (r.nav ? [{ path: `/${r.path}`, ...r.nav }] : []))
    .sort((a, b) => a.order - b.order);
}
