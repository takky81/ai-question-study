import type { ReactElement } from 'react';
import { Link } from 'react-router';

/** 描画時例外の表示（errorElement）。詳細は出さず、ホームへの導線を示す。 */
export function RouteErrorPage(): ReactElement {
  return (
    <div role="alert" className="flex min-w-0 flex-col items-start gap-4 bg-bg p-4 text-text">
      <h1 className="text-xl font-bold break-words">問題が発生しました</h1>
      <p className="break-words">画面を表示できませんでした。時間をおいて再度お試しください。</p>
      <Link to="/" className="tap-target focus-ring flex items-center rounded text-primary underline">
        ホームへ戻る
      </Link>
    </div>
  );
}
