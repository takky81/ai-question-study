// 起動時の分岐: 環境変数を検証し、失敗ならアプリ本体を読み込まずに設定不足を表示する（1.6、3.6）。
import { type ComponentType, StrictMode } from 'react';
import type { Root } from 'react-dom/client';

import { parseEnv } from '../lib/env';
import { EnvErrorPage } from './EnvErrorPage';

export type AppModule = { App: ComponentType };

export async function bootstrap(
  root: Root,
  raw: Record<string, string | undefined>,
  loadApp: () => Promise<AppModule>,
): Promise<void> {
  const result = parseEnv(raw);
  if (!result.ok) {
    root.render(
      <StrictMode>
        <EnvErrorPage missing={result.missing} />
      </StrictMode>,
    );
    return;
  }
  // supabase.ts は読み込み時に設定を検証して例外を出すため、検証成功後に読み込む
  let App: ComponentType;
  try {
    ({ App } = await loadApp());
  } catch (error) {
    // デプロイで分割ファイル名が変わった直後や通信障害で失敗しうるため、空白にせず再読み込みを促す
    console.error('アプリ本体の読み込みに失敗しました', error);
    root.render(
      <StrictMode>
        <main className="p-4">
          <p role="alert">読み込みに失敗しました。ページを再読み込みしてください。</p>
        </main>
      </StrictMode>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
