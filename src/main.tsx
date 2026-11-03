import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// 最小画面。環境変数検証・認証・ルーターは後続タスクでここに組み込む。
const container = document.getElementById('root');
if (!container) {
  throw new Error('#root 要素が見つかりません');
}
createRoot(container).render(
  <StrictMode>
    <main />
  </StrictMode>,
);
