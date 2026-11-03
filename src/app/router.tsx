// APP_ROUTES から公開・保護・404 を合成し、basename をビルドの base と同期させる（2.1、2.4、4.5）。
import type { ReactElement } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppLayout } from '../components/AppLayout';
import { signOut } from '../features/auth/api';
import { RequireAuth } from '../features/auth/RequireAuth';
import { NotFoundPage } from './NotFoundPage';
import { RouteErrorPage } from './RouteErrorPage';
import { toNavItems, type AppRoute } from './routes';

/** BASE_URL の末尾 / を除いた値。ルート配信時は '/'（2.1、2.2）。 */
export function toBasename(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function toRouteObject(route: AppRoute): RouteObject {
  return route.path === '' ? { index: true, element: route.element } : { path: route.path, element: route.element };
}

/** ルート定義を合成する。テストでは createMemoryRouter に渡して使う。 */
export function buildRouteObjects(routes: readonly AppRoute[]): RouteObject[] {
  const navItems = toNavItems(routes);
  const layout: ReactElement = <AppLayout navItems={navItems} onSignOut={signOut} />;
  return [
    {
      path: '/',
      errorElement: <RouteErrorPage />,
      children: [
        // 公開ルートはガードとレイアウトの外に置く
        ...routes.filter((r) => r.public).map(toRouteObject),
        {
          element: <RequireAuth />,
          children: [
            {
              element: layout,
              // レイアウト内の描画時例外はレイアウトを残したままエラー画面を出す
              children: [{ errorElement: <RouteErrorPage />, children: routes.filter((r) => !r.public).map(toRouteObject) }],
            },
          ],
        },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ];
}

export function createAppRouter(routes: readonly AppRoute[]): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(buildRouteObjects(routes), { basename: toBasename(import.meta.env.BASE_URL) });
}
