import type { ReactElement } from 'react';

/** 接続設定が欠けているときの表示。欠けた変数名を列挙する（1.6）。 */
export function EnvErrorPage(props: { missing: readonly string[] }): ReactElement {
  return (
    <main className="flex min-h-dvh min-w-0 flex-col items-start gap-4 bg-bg p-4 text-text">
      <h1 className="text-xl font-bold break-words">設定が不足しています: {props.missing.join('、')}</h1>
      <p className="break-words">.env.local などで上記の環境変数を設定してから、アプリを再起動してください。</p>
      <ul className="list-disc pl-6">
        {props.missing.map((name) => (
          <li key={name} className="break-all font-mono">
            {name}
          </li>
        ))}
      </ul>
    </main>
  );
}
