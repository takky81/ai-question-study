// GitHub Pages で深いリンクを再読み込みしてもアプリが起動するよう、
// ビルド後に dist/index.html を dist/404.html として複製する。
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const index = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const notFound = fileURLToPath(new URL('../dist/404.html', import.meta.url));

if (!existsSync(index)) {
  console.error('dist/index.html がありません。先に vite build を実行してください。');
  process.exit(1);
}
copyFileSync(index, notFound);
console.log('dist/404.html を作成しました。');
