import { createRoot } from 'react-dom/client';

import { bootstrap } from './app/bootstrap';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root 要素が見つかりません');
}
void bootstrap(createRoot(container), import.meta.env, () => import('./app/App'));
