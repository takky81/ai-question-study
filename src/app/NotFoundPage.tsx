import type { ReactElement } from 'react';
import { Link } from 'react-router';

/** 存在しない URL の表示とホームへの導線（2.4）。 */
export function NotFoundPage(): ReactElement {
  return (
    <main className="flex min-h-dvh min-w-0 flex-col items-start gap-4 bg-bg p-4 text-text">
      <h1 className="text-xl font-bold break-words">ページが見つかりません</h1>
      <p className="break-words">指定された URL のページは存在しません。</p>
      <Link to="/" className="tap-target focus-ring flex items-center rounded text-primary underline">
        ホームへ戻る
      </Link>
    </main>
  );
}
