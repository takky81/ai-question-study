// ビルド成果物の検査（CI とローカルの両方で実行する）。
// - dist/404.html が dist/index.html と同一であること（深いリンクの再読み込み対策）
// - index.html 内の資産参照（src / href）がサブパス `/<リポジトリ名>/` 始まりであること
// リポジトリ名は GITHUB_REPOSITORY（owner/name）から求め、未設定時は既定値を使う。
// この決め方は src/lib/basePath.ts の resolveBase と一致させること（.mjs から .ts を import できないため複製している）。
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPOSITORY_NAME = 'ai-question-study';
const distDir = process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url));
const name = process.env.GITHUB_REPOSITORY?.split('/').pop()?.trim() || DEFAULT_REPOSITORY_NAME;
const base = `/${name}/`;

const errors = [];
const indexPath = `${distDir}/index.html`;
const notFoundPath = `${distDir}/404.html`;

if (!existsSync(indexPath)) {
  errors.push('dist/index.html がありません。');
} else {
  const index = readFileSync(indexPath, 'utf8');

  if (!existsSync(notFoundPath)) {
    errors.push('dist/404.html がありません。');
  } else if (readFileSync(notFoundPath, 'utf8') !== index) {
    errors.push('dist/404.html が dist/index.html と一致しません。');
  }

  // 外部 URL・データ URL・アンカーを除いた資産参照を対象にする
  const refs = [...index.matchAll(/\b(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => !/^(?:[a-z]+:|\/\/|#)/i.test(url));
  if (refs.length === 0) {
    errors.push('dist/index.html に資産参照が見つかりません。');
  }
  for (const url of refs) {
    if (!url.startsWith(base)) {
      errors.push(`資産参照がサブパス ${base} で始まっていません: ${url}`);
    }
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`NG: ${e}`);
  process.exit(1);
}
console.log(`OK: dist/404.html は index.html と同一で、資産参照はすべて ${base} 始まりです。`);
