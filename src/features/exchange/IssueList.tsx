// 検証のエラー・警告を該当箇所付きで表示する（4.2、4.3、4.10）。色だけに頼らず印と文字で区別する。
import type { ReactElement } from 'react';
import { CircleAlert, TriangleAlert } from 'lucide-react';

import type { ImportIssue } from './importValidate';
import type { FormatIssue } from './parse';

/** フォーマット検証の問題（severity なし）はエラーとして扱う。 */
export type DisplayIssue = FormatIssue | ImportIssue;

const SECTION_LABEL: Record<string, string> = {
  'keywords.add': 'キーワードの追加',
  'keywords.rename': 'キーワードの改名',
  'keywords.move': 'キーワードの移動',
  'questions.update': '問題の修正',
  'questions.create': '問題の新規作成',
  'questions.disable': '問題の無効化',
};

const FIELD_LABEL: Record<string, string> = {
  format: 'フォーマットの種類',
  version: 'バージョン',
  exportedAt: '出力日時',
  basedOnExportedAt: 'もとにした出力日時',
  subjectId: '科目',
  keywords: '紐づくキーワード',
  questions: '問題',
  name: '名前',
  parent: '親',
  parentId: '親',
  tempKey: '一時キー',
  id: 'ID',
  kind: '種別',
  stem: '問題文',
  explanation: '解説',
  choices: '選択肢',
  body: '本文',
  isCorrect: '正解',
  reason: '理由',
};

type Token = { name: string } | { index: number };

function tokenize(path: string): Token[] {
  const tokens: Token[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    tokens.push(m[2] !== undefined ? { index: Number(m[2]) } : { name: m[1]! });
  }
  return tokens;
}

/** 位置の表記（例: `questions.update[3].choices[1].body` → 「問題の修正 4件目 / 選択肢 2 / 本文」）。 */
export function formatIssuePath(path: string): string {
  const tokens = tokenize(path);
  if (tokens.length === 0) return 'ファイル全体';
  const parts: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if ('name' in t) {
      const sectionKey = next && 'name' in next ? `${t.name}.${next.name}` : null;
      if (sectionKey && SECTION_LABEL[sectionKey]) {
        parts.push(SECTION_LABEL[sectionKey]);
        i += 2;
        continue;
      }
      parts.push(FIELD_LABEL[t.name] ?? t.name);
    } else {
      const prev = parts.pop() ?? '';
      const n = t.index + 1;
      parts.push(prev === '選択肢' ? `選択肢 ${n}` : `${prev} ${n}件目`.trim());
    }
    i += 1;
  }
  return parts.join(' / ');
}

const isWarning = (issue: DisplayIssue) => 'severity' in issue && issue.severity === 'warning';

function Group({ kind, issues }: { kind: 'error' | 'warning'; issues: DisplayIssue[] }): ReactElement | null {
  if (issues.length === 0) return null;
  const label = kind === 'error' ? 'エラー' : '警告';
  const Icon = kind === 'error' ? CircleAlert : TriangleAlert;
  const heading = `${label} ${issues.length}件`;
  return (
    <section aria-label={heading} className="min-w-0 rounded border border-border p-3">
      <h3 className={`flex items-center gap-1 font-semibold ${kind === 'warning' ? 'text-warn' : 'text-text'}`}>
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {heading}
      </h3>
      <ul className="mt-2 space-y-1 text-sm">
        {issues.map((issue, i) => (
          <li key={i} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span
              className={`inline-flex shrink-0 items-center gap-0.5 rounded border px-1 text-xs font-semibold ${
                kind === 'warning' ? 'border-warn text-warn' : 'border-text text-text'
              }`}
            >
              <Icon aria-hidden="true" className="size-3" />
              {label}
            </span>
            <span className="text-text-muted break-words">{formatIssuePath(issue.path)}</span>
            <span className="min-w-0 break-words">{issue.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function IssueList({ issues }: { issues: readonly DisplayIssue[] }): ReactElement | null {
  if (issues.length === 0) return null;
  const errors = issues.filter((x) => !isWarning(x));
  const warnings = issues.filter(isWarning);
  return (
    <div className="space-y-3">
      <Group kind="error" issues={errors} />
      <Group kind="warning" issues={warnings} />
    </div>
  );
}
