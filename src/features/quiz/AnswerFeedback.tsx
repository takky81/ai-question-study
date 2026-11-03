// 判定後の問題の解説と、紐づく各キーワードの階層パス（5.5、5.6）。判定前は描画しない（5.7）。
import { keywordPath, type KeywordNode } from '@/lib/keywordTree';

type Props = {
  judged: boolean;
  explanation: string;
  keywordIds: string[];
  keywords: readonly KeywordNode[];
};

export function AnswerFeedback({ judged, explanation, keywordIds, keywords }: Props) {
  if (!judged) return null;
  const paths = keywordIds
    .map((id) => ({ id, path: keywordPath(keywords, id) }))
    .filter((p) => p.path.length > 0);

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded border border-border bg-surface p-3" aria-label="解説">
      {explanation !== '' && <p className="min-w-0 whitespace-pre-wrap break-words text-text">{explanation}</p>}
      {paths.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-1 text-sm text-text-muted">
          {paths.map((p) => (
            <li key={p.id} className="min-w-0 break-words">
              {p.path.map((n) => n.name).join(' / ')}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
