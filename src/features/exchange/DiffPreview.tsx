// 差分プレビュー: 件数、キーワードと問題の差分、解消予定のフラグ、変更なし（5.1〜5.7、10.2、10.5）
import type { ReactElement, ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

import { QUESTION_FLAGS } from '@/features/quiz/flags';
import type { QuestionKind } from '@/features/catalog/types';
import { keywordPath, type KeywordNode } from '@/lib/keywordTree';

import type { ChoiceChange, ImportDiff, KeywordChange, QuestionChange } from './diff';
import type { KeywordRef } from './format';

type Props = {
  diff: ImportDiff;
  /** 現在の科目のキーワード（変更前の階層パスの表示に使う） */
  keywords: readonly KeywordNode[];
};

type ChoiceLike = { body: string; explanation: string; isCorrect: boolean };

const KIND_LABEL: Record<QuestionKind, string> = { keyword: 'キーワード問題', feature: '特徴問題' };
const FIELD_LABEL: Record<QuestionChange['fields'][number], string> = {
  kind: '種別',
  stem: '問題文',
  explanation: '解説',
  keywords: '紐づくキーワード',
};
const CHOICE_MARK: Record<ChoiceChange['type'], string> = {
  added: '追加',
  removed: '削除',
  changed: '変更',
  moved: '並べ替え',
};
const FLAG_LABEL = new Map<string, string>(QUESTION_FLAGS.map((f) => [f.id, f.label]));

const pathText = (path: readonly string[]) => path.join(' / ');

function Section({ label, count, children }: { label: string; count: number; children: ReactNode }): ReactElement | null {
  if (count === 0) return null;
  return (
    <section aria-label={label} className="min-w-0">
      <details open className="rounded border border-border">
        <summary className="focus-ring tap-target flex cursor-pointer items-center px-3 font-semibold">
          {label}（{count}件）
        </summary>
        <div className="space-y-3 border-t border-border p-3">{children}</div>
      </details>
    </section>
  );
}

function UpdatedSinceExport(): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-warn">
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
      出力後に更新されています
    </span>
  );
}

/** 選択肢の表示。正解はアプリ共通の正解の色と ○ の印（10.5）。 */
function Choice({ choice, showExplanation = true }: { choice: ChoiceLike; showExplanation?: boolean }): ReactElement {
  return (
    <div className={`min-w-0 rounded border border-border px-2 py-1 ${choice.isCorrect ? 'mark-correct' : ''}`}>
      <div className="flex min-w-0 items-baseline gap-1">
        {choice.isCorrect ? (
          <span aria-label="正解" className="shrink-0 font-bold">
            ○
          </span>
        ) : null}
        <span className="min-w-0 break-words">{choice.body}</span>
      </div>
      {showExplanation ? <p className="break-words text-sm text-text-muted">{choice.explanation}</p> : null}
    </div>
  );
}

/** 変更前と変更後。PC 幅では2列、モバイルでは縦に並べる（10.2）。 */
function BeforeAfter({ before, after }: { before: ReactNode; after: ReactNode }): ReactElement {
  return (
    <div className="grid min-w-0 gap-2 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="text-xs text-text-muted">変更前</p>
        {before}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-muted">変更後</p>
        {after}
      </div>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-text-muted">{children}</span>;

function PathList({ paths }: { paths: string[][] }): ReactElement {
  if (paths.length === 0) return <Muted>なし</Muted>;
  return (
    <ul className="space-y-0.5">
      {paths.map((p, i) => (
        <li key={i} className="break-words">
          {pathText(p)}
        </li>
      ))}
    </ul>
  );
}

function KeywordRow({ change }: { change: KeywordChange }): ReactElement {
  const label = change.type === 'added' ? '追加' : change.type === 'renamed' ? '改名' : '移動';
  return (
    <li className="min-w-0 space-y-1">
      <span className="rounded border border-border px-1 text-xs font-semibold">{label}</span>
      {change.type === 'added' ? (
        <BeforeAfter before={<Muted>なし</Muted>} after={<p className="break-words">{pathText(change.afterPath)}</p>} />
      ) : (
        <BeforeAfter
          before={<p className="break-words">{pathText(change.beforePath)}</p>}
          after={<p className="break-words">{pathText(change.afterPath)}</p>}
        />
      )}
    </li>
  );
}

function ChoiceRow({ change, after }: { change: ChoiceChange; after: ChoiceLike[] }): ReactElement {
  let content: ReactNode;
  switch (change.type) {
    case 'added':
      content = <BeforeAfter before={<Muted>なし</Muted>} after={<Choice choice={change.after} />} />;
      break;
    case 'removed':
      content = <BeforeAfter before={<Choice choice={change.before} />} after={<Muted>なし</Muted>} />;
      break;
    case 'changed': {
      const showExplanation = change.fields.includes('explanation');
      content = (
        <BeforeAfter
          before={<Choice choice={change.before} showExplanation={showExplanation} />}
          after={<Choice choice={change.after} showExplanation={showExplanation} />}
        />
      );
      break;
    }
    case 'moved': {
      const moved = after[change.toIndex];
      content = (
        <div className="space-y-1">
          <p className="text-sm">
            {change.fromIndex + 1}番目 → {change.toIndex + 1}番目
          </p>
          {moved ? <Choice choice={moved} showExplanation={false} /> : null}
        </div>
      );
      break;
    }
  }
  return (
    <li className="min-w-0 space-y-1">
      <span className="rounded border border-border px-1 text-xs font-semibold">{CHOICE_MARK[change.type]}</span>
      {content}
    </li>
  );
}

function UpdatedQuestion({
  change,
  beforePaths,
  afterPaths,
  order,
}: {
  change: QuestionChange;
  order: number;
  beforePaths: string[][];
  afterPaths: string[][];
}): ReactElement {
  const { before, after } = change;
  const value = (field: QuestionChange['fields'][number], side: 'before' | 'after'): ReactNode => {
    switch (field) {
      case 'kind':
        return <p>{KIND_LABEL[side === 'before' ? before.kind : after.kind]}</p>;
      case 'stem':
        return <p className="break-words">{side === 'before' ? before.stem : after.stem}</p>;
      case 'explanation':
        return <p className="break-words">{side === 'before' ? before.explanation : after.explanation}</p>;
      case 'keywords':
        return <PathList paths={side === 'before' ? beforePaths : afterPaths} />;
    }
  };
  return (
    <article className="min-w-0 space-y-2 rounded border border-border p-3">
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h4 className="font-semibold">修正 {order}件目</h4>
        {change.fields.includes('stem') ? null : <p className="min-w-0 break-words text-sm">{before.stem}</p>}
        {change.updatedSinceExport ? <UpdatedSinceExport /> : null}
      </header>
      {change.fields.map((field) => (
        <div key={field} className="space-y-1">
          <p className="text-sm font-semibold">{FIELD_LABEL[field]}</p>
          <BeforeAfter before={value(field, 'before')} after={value(field, 'after')} />
        </div>
      ))}
      {change.choices.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-semibold">選択肢</p>
          <ul className="space-y-2">
            {change.choices.map((c, i) => (
              <ChoiceRow key={i} change={c} after={after.choices} />
            ))}
          </ul>
        </div>
      ) : null}
      {change.flagsToResolve.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-semibold">解消予定のフラグ</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {change.flagsToResolve.map((f, i) => (
              <li key={i} className="break-words">
                {FLAG_LABEL.get(f.flag) ?? f.flag}
                {f.note ? `: ${f.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

export function DiffPreview({ diff, keywords }: Props): ReactElement {
  const { counts } = diff;
  const afterPathById = new Map<string, string[]>();
  const afterPathByTemp = new Map<string, string[]>();
  for (const k of diff.keywords) {
    if (k.type === 'added') afterPathByTemp.set(k.tempKey, k.afterPath);
    else afterPathById.set(k.id, k.afterPath);
  }
  const currentPath = (id: string) => keywordPath(keywords, id).map((n) => n.name);
  const refPath = (ref: KeywordRef) =>
    'id' in ref ? (afterPathById.get(ref.id) ?? currentPath(ref.id)) : (afterPathByTemp.get(ref.tempKey) ?? []);

  const summary: [string, number][] = [
    ['キーワードの追加', counts.keywordsAdded],
    ['キーワードの改名', counts.keywordsRenamed],
    ['キーワードの移動', counts.keywordsMoved],
    ['問題の修正', counts.questionsUpdated],
    ['問題の新規作成', counts.questionsCreated],
    ['問題の無効化', counts.questionsDisabled],
  ];

  return (
    <div className="min-w-0 space-y-4">
      <section aria-label="変更の件数">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {summary.map(([label, n]) => (
            <div key={label} className="rounded border border-border p-2">
              <dt className="text-xs text-text-muted">{label}</dt>
              <dd className="text-lg font-semibold">{n}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Section label="キーワードの変更" count={diff.keywords.length}>
        <ul className="space-y-3">
          {diff.keywords.map((k, i) => (
            <KeywordRow key={i} change={k} />
          ))}
        </ul>
      </Section>

      <Section label="問題の修正" count={diff.updated.length}>
        {diff.updated.map((q, i) => (
          <UpdatedQuestion
            key={q.id}
            order={i + 1}
            change={q}
            beforePaths={q.fields.includes('keywords') ? q.before.keywordIds.map(currentPath) : []}
            afterPaths={q.fields.includes('keywords') ? q.after.keywords.map(refPath) : []}
          />
        ))}
      </Section>

      <Section label="問題の新規作成" count={diff.created.length}>
        {diff.created.map((c) => (
          <article key={c.index} className="min-w-0 space-y-2 rounded border border-border p-3">
            <p className="text-xs text-text-muted">{KIND_LABEL[c.body.kind]}</p>
            <h4 className="break-words font-semibold">{c.body.stem}</h4>
            <p className="break-words text-sm">{c.body.explanation}</p>
            <div className="space-y-1">
              <p className="text-sm font-semibold">紐づくキーワード</p>
              <PathList paths={c.keywordPaths} />
            </div>
            <ul className="space-y-1">
              {c.body.choices.map((ch, i) => (
                <li key={i}>
                  <Choice choice={ch} />
                </li>
              ))}
            </ul>
          </article>
        ))}
      </Section>

      <Section label="問題の無効化" count={diff.disabled.length}>
        <ul className="space-y-2">
          {diff.disabled.map((d) => (
            <li key={d.id} className="min-w-0 rounded border border-border p-2">
              <p className="break-words">{d.stem}</p>
              <p className="break-words text-sm text-text-muted">
                理由: {d.reason ?? 'なし'}
                {d.alreadyDisabled ? '（すでに無効）' : ''}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      {diff.unchanged.length > 0 ? (
        <details className="rounded border border-border">
          <summary className="focus-ring tap-target flex cursor-pointer items-center px-3 text-text-muted">
            変更なし（{diff.unchanged.length}件）
          </summary>
          <ul className="border-t border-border p-3 text-sm text-text-muted">
            {diff.unchanged.map((id) => (
              <li key={id} className="break-all">
                {id}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
