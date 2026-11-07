// 推測の機械的な点検（要件 12.2〜12.8）。問題文と選択肢の見た目だけで正解を絞り込める問題を警告する。
// 形態素解析は使わず、文字種の連続から語を取り出す。Node の型除去だけで動く純粋関数として書く。
import type { AuthoredQuestion } from './importModel.ts';

export type LintKind =
  'stem_overlap' | 'length_outlier' | 'form_outlier' | 'absolute_word' | 'containment' | 'full_name';
export type LintWarning = { kind: LintKind; choiceIndex: number | null; terms: string[] };

export type LintOptions = {
  minTermLength: number; // 語として扱う最小の文字数
  longRatio: number; // 正解の長さが中央値のこの倍以上なら長すぎる
  shortRatio: number; // 正解の長さが中央値のこの倍以下なら短すぎる
  commonWords: readonly string[]; // 重なりとして数えない一般語
  absoluteWords: readonly string[]; // 断定語
};

export const COMMON_WORDS: readonly string[] = [
  '処理',
  '方式',
  'データ',
  '情報',
  '機能',
  '方法',
  '利用',
  '使用',
  '管理',
  '場合',
  'システム',
  '特徴',
  '説明',
  '必要',
  '適切',
  '対象',
];
export const ABSOLUTE_WORDS: readonly string[] = ['必ず', 'すべて', '常に', '一切', '絶対', 'のみ'];

export const DEFAULT_LINT_OPTIONS: LintOptions = {
  minTermLength: 2,
  longRatio: 1.8,
  shortRatio: 0.5,
  commonWords: COMMON_WORDS,
  absoluteWords: ABSOLUTE_WORDS,
};

type CharType = 'kanji' | 'katakana' | 'alnum' | 'hiragana' | 'other';

function charType(ch: string): CharType {
  if (/\p{Script=Han}|々/u.test(ch)) return 'kanji';
  if (/[\p{Script=Katakana}ー]/u.test(ch)) return 'katakana';
  if (/[A-Za-z0-9Ａ-Ｚａ-ｚ０-９]/u.test(ch)) return 'alnum';
  if (/\p{Script=Hiragana}/u.test(ch)) return 'hiragana';
  return 'other';
}

function runs(text: string): { type: CharType; text: string }[] {
  const out: { type: CharType; text: string }[] = [];
  for (const ch of text) {
    const type = charType(ch);
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += ch;
    else out.push({ type, text: ch });
  }
  return out;
}

/** 漢字・カタカナの連続は2文字以上の部分文字列すべて、英数字の連続は語そのものを返す（一般語は除く）。 */
export function extractTerms(text: string, options: LintOptions = DEFAULT_LINT_OPTIONS): string[] {
  const terms = new Set<string>();
  for (const run of runs(text)) {
    const chars = Array.from(run.text);
    if (chars.length < options.minTermLength) continue;
    if (run.type === 'alnum') terms.add(run.text);
    else if (run.type === 'kanji' || run.type === 'katakana') {
      for (let i = 0; i < chars.length; i++)
        for (let j = i + options.minTermLength; j <= chars.length; j++) terms.add(chars.slice(i, j).join(''));
    }
  }
  for (const w of options.commonWords) terms.delete(w);
  return [...terms];
}

const len = (s: string) => Array.from(s).length;

function stemOverlap(q: AuthoredQuestion, o: LintOptions): LintWarning[] {
  const stemTerms = new Set(extractTerms(q.stem, o));
  const shared = q.choices.map((c) => extractTerms(c.body, o).filter((t) => stemTerms.has(t)));
  const longest = shared.map((ts) => Math.max(0, ...ts.map(len)));
  const out: LintWarning[] = [];
  q.choices.forEach((c, i) => {
    if (!c.isCorrect || (longest[i] ?? 0) < o.minTermLength) return;
    const beatsAll = q.choices.every((d, j) => d.isCorrect || (longest[j] ?? 0) < (longest[i] ?? 0));
    if (beatsAll)
      out.push({
        kind: 'stem_overlap',
        choiceIndex: i,
        terms: (shared[i] ?? []).filter((t) => len(t) === (longest[i] ?? 0)),
      });
  });
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

function lengthOutlier(q: AuthoredQuestion, o: LintOptions): LintWarning[] {
  if (q.kind !== 'feature' || q.choices.length < 3) return [];
  const lengths = q.choices.map((c) => len(c.body));
  const med = median(lengths);
  if (med === 0) return [];
  const isOut = (n: number) => n >= med * o.longRatio || n <= med * o.shortRatio;
  // 正解「だけ」が外れるときに限る
  if (q.choices.some((c, i) => !c.isCorrect && isOut(lengths[i] ?? 0))) return [];
  return q.choices.flatMap((c, i) =>
    c.isCorrect && isOut(lengths[i] ?? 0) ? [{ kind: 'length_outlier' as const, choiceIndex: i, terms: [c.body] }] : [],
  );
}

/** 他の全選択肢が1つの仲間にまとまり、1つだけ外れるときにその位置を返す。 */
function oddOne(keys: string[]): number | null {
  if (keys.length < 3) return null;
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  if (counts.size !== 2) return null;
  const odd = [...counts].find(([, n]) => n === 1);
  return odd ? keys.indexOf(odd[0]) : null;
}

function formOutlier(q: AuthoredQuestion): LintWarning[] {
  const tails = q.choices.map((c) => Array.from(c.body.trim()).slice(-2).join(''));
  let i = oddOne(tails);
  if (i === null) i = oddOne(tails.map((t) => Array.from(t).map(charType).join('+')));
  return i === null ? [] : [{ kind: 'form_outlier', choiceIndex: i, terms: [tails[i] ?? ''] }];
}

function absoluteWord(q: AuthoredQuestion, o: LintOptions): LintWarning[] {
  // 正解に断定語が1つでもあれば「誤答にだけ」ではないので警告しない
  if (q.choices.some((c) => c.isCorrect && o.absoluteWords.some((w) => c.body.includes(w)))) return [];
  return q.choices.flatMap((c, i) => {
    if (c.isCorrect) return [];
    const words = o.absoluteWords.filter((w) => c.body.includes(w));
    return words.length ? [{ kind: 'absolute_word' as const, choiceIndex: i, terms: words }] : [];
  });
}

function containment(q: AuthoredQuestion): LintWarning[] {
  const bodies = q.choices.map((c) => c.body.trim());
  return bodies.flatMap((b, i) => {
    const inner = bodies.filter((d, j) => j !== i && d !== '' && d !== b && b.includes(d));
    return inner.length ? [{ kind: 'containment' as const, choiceIndex: i, terms: inner }] : [];
  });
}

function fullName(q: AuthoredQuestion): LintWarning[] {
  const texts = [q.stem, ...q.choices.map((c) => c.body)];
  const abbrs = new Set(texts.flatMap((t) => t.match(/(?<![A-Za-z])[A-Z]{2,}(?![A-Za-z])/g) ?? []));
  const out: LintWarning[] = [];
  for (const abbr of abbrs) {
    texts.forEach((t, ti) => {
      const words = t.match(/[A-Za-z]{2,}/g) ?? [];
      for (let s = 0; s + abbr.length <= words.length; s++) {
        const seq = words.slice(s, s + abbr.length);
        if (seq.includes(abbr)) continue;
        if (seq.every((w, k) => w.charAt(0).toUpperCase() === abbr.charAt(k))) {
          // 連続した語の並びとして本文に現れることを確かめる
          const phrase = seq.join(' ');
          if (!new RegExp(seq.join('[\\s\\-]+')).test(t)) continue;
          out.push({ kind: 'full_name', choiceIndex: ti === 0 ? null : ti - 1, terms: [abbr, phrase] });
          return;
        }
      }
    });
  }
  return out;
}

export function lintQuestion(q: AuthoredQuestion, options: Partial<LintOptions> = {}): LintWarning[] {
  const o: LintOptions = { ...DEFAULT_LINT_OPTIONS, ...options };
  return [
    ...stemOverlap(q, o),
    ...lengthOutlier(q, o),
    ...formOutlier(q),
    ...absoluteWord(q, o),
    ...containment(q),
    ...fullName(q),
  ];
}
