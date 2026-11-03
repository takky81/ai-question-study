// アプリ本体。supabase.ts を間接的に読み込むため、環境変数の検証成功後にだけ動的 import する。
import { type ReactElement, useState } from 'react';
import { RouterProvider } from 'react-router';

import { AuthProvider } from '../features/auth/AuthProvider';
import { createAppRouter } from './router';
import { APP_ROUTES } from './routes';

export function App(): ReactElement {
  // 再描画でルーターを作り直さない
  const [router] = useState(() => createAppRouter(APP_ROUTES));
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
