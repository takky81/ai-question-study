// 交換フォーマットの読み込み検証（4.2、4.3、3.7）。unknown → 型付きの値 + FormatIssue[]。
import type { QuestionKind } from '@/features/catalog/types';
import { QUESTION_FLAGS } from '@/features/quiz/flags';
import { EXCHANGE_FORMAT, EXCHANGE_VERSION, type ExportFileV1, type ImportFileV1 } from './format';

export type FormatIssueCode =
  | 'invalid_json'
  | 'wrong_format'
  | 'unsupported_version'
  | 'missing_field'
  | 'invalid_type'
  | 'unknown_field'
  | 'invalid_value';

/** path 例: 'questions.update[3].choices[1].body'（ルートは空文字）。 */
export type FormatIssue = { path: string; code: FormatIssueCode; message: string };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: FormatIssue[] };

// ---- 小さなスキーマ記述 ----

type Ctx = { issues: FormatIssue[] };
type Check = (value: unknown, path: string, ctx: Ctx) => unknown;

type Field = { check: Check; optional?: 'omit' | (() => unknown) };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const add = (ctx: Ctx, path: string, code: FormatIssueCode, message: string) => {
  ctx.issues.push({ path, code, message });
};

const join = (base: string, key: string) => (base === '' ? key : `${base}.${key}`);

const typed =
  (test: (v: unknown) => boolean, label: string): Check =>
  (v, path, ctx) => {
    if (!test(v)) add(ctx, path, 'invalid_type', `${label}である必要があります`);
    return v;
  };

const str = typed((v) => typeof v === 'string', '文字列');
const num = typed((v) => typeof v === 'number' && Number.isFinite(v), '数値');
const bool = typed((v) => typeof v === 'boolean', '真偽値');

const nullable =
  (inner: Check): Check =>
  (v, path, ctx) =>
    v === null ? null : inner(v, path, ctx);

const oneOf =
  (values: readonly string[]): Check =>
  (v, path, ctx) => {
    if (typeof v !== 'string') add(ctx, path, 'invalid_type', '文字列である必要があります');
    else if (!values.includes(v))
      add(ctx, path, 'invalid_value', `${values.join('、')} のいずれかである必要があります（値: ${v}）`);
    return v;
  };

const arr =
  (item: Check): Check =>
  (v, path, ctx) => {
    if (!Array.isArray(v)) {
      add(ctx, path, 'invalid_type', '配列である必要があります');
      return v;
    }
    return v.map((x, i) => item(x, `${path}[${i}]`, ctx));
  };

const obj =
  (fields: Record<string, Field | Check>): Check =>
  (v, path, ctx) => {
    if (!isObject(v)) {
      add(ctx, path, 'invalid_type', 'オブジェクトである必要があります');
      return v;
    }
    const out: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(fields)) {
      const field: Field = typeof spec === 'function' ? { check: spec } : spec;
      const p = join(path, key);
      if (!Object.hasOwn(v, key) || v[key] === undefined) {
        if (field.optional === 'omit') continue;
        if (field.optional) out[key] = field.optional();
        else add(ctx, p, 'missing_field', '必須の項目がありません');
        continue;
      }
      out[key] = field.check(v[key], p, ctx);
    }
    for (const key of Object.keys(v)) {
      if (!Object.hasOwn(fields, key)) add(ctx, join(path, key), 'unknown_field', `未知の項目または操作です（${key}）`);
    }
    return out;
  };

const keywordRef: Check = (v, path, ctx) => {
  if (!isObject(v)) {
    add(ctx, path, 'invalid_type', 'キーワード参照（{ id } または { tempKey }）である必要があります');
    return v;
  }
  const keys = Object.keys(v);
  if (keys.length === 1 && (keys[0] === 'id' || keys[0] === 'tempKey') && typeof v[keys[0]] === 'string') {
    return { [keys[0]]: v[keys[0]] };
  }
  add(ctx, path, 'invalid_value', 'キーワード参照は { id: 文字列 } か { tempKey: 文字列 } のどちらか一方である必要があります');
  return v;
};

const reason: Check = (v, path, ctx) => {
  if (v === null) return null;
  str(v, path, ctx);
  return typeof v === 'string' && v.trim() === '' ? null : v;
};

const QUESTION_KINDS: readonly QuestionKind[] = ['keyword', 'feature'];
const FLAG_IDS: readonly string[] = QUESTION_FLAGS.map((f) => f.id);
const kind = oneOf(QUESTION_KINDS);
const flagId = oneOf(FLAG_IDS);
const emptyArr = () => [];
const listOf = (item: Check): Field => ({ check: arr(item), optional: emptyArr });

// ---- 取込用 ----

const importChoiceUpdate = obj({
  id: { check: str, optional: 'omit' },
  body: str,
  explanation: str,
  isCorrect: bool,
});
const importChoiceCreate = obj({ body: str, explanation: str, isCorrect: bool });

const importBody = (choice: Check) => ({
  kind,
  stem: str,
  explanation: str,
  keywords: arr(keywordRef),
  choices: arr(choice),
});

const importRoot = obj({
  format: str,
  version: num,
  subjectId: str,
  basedOnExportedAt: { check: nullable(str), optional: () => null },
  keywords: {
    check: obj({
      add: listOf(obj({ tempKey: str, parent: nullable(keywordRef), name: str })),
      rename: listOf(obj({ id: str, name: str })),
      move: listOf(obj({ id: str, parent: nullable(keywordRef) })),
    }),
    optional: () => ({ add: [], rename: [], move: [] }),
  },
  questions: {
    check: obj({
      update: listOf(obj({ id: str, ...importBody(importChoiceUpdate) })),
      create: listOf(obj({ tempKey: { check: str, optional: 'omit' }, ...importBody(importChoiceCreate) })),
      disable: listOf(obj({ id: str, reason: { check: reason, optional: () => null } })),
    }),
    optional: () => ({ update: [], create: [], disable: [] }),
  },
});

// ---- 出力用 ----

const nNum = nullable(num);

const exportRoot = obj({
  format: str,
  version: num,
  exportedAt: str,
  subject: obj({ id: str, name: str }),
  conditions: obj({
    keywordId: nullable(str),
    flag: oneOf(['all', 'any', 'none', 'types']),
    flagTypes: arr(flagId),
    correctRateMin: nNum,
    correctRateMax: nNum,
    attemptMin: nNum,
    attemptMax: nNum,
    attempted: nullable(bool),
    includeDisabled: bool,
  }),
  keywords: listOf(
    obj({
      id: str,
      parentId: nullable(str),
      name: str,
      sortOrder: num,
      path: arr(str),
      stats: obj({ questionCount: num, attemptCount: num, correctCount: num, correctRate: nNum }),
    }),
  ),
  questions: listOf(
    obj({
      id: str,
      kind,
      stem: str,
      explanation: str,
      keywordIds: arr(str),
      status: oneOf(['active', 'disabled']),
      disabledReason: nullable(str),
      updatedAt: str,
      choices: arr(obj({ id: str, body: str, explanation: str, isCorrect: bool })),
      openFlags: arr(obj({ flag: flagId, note: nullable(str), createdAt: str })),
      stats: obj({ attemptCount: num, correctCount: num, correctRate: nNum, retention: nNum }),
    }),
  ),
});

// ---- 入口 ----

function parseWith<T>(text: string, expectedFormat: string, label: string, root: Check): ParseResult<T> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: '', code: 'invalid_json', message: 'JSON として読めません' }] };
  }
  if (!isObject(data) || data.format !== expectedFormat) {
    return {
      ok: false,
      issues: [{ path: 'format', code: 'wrong_format', message: `${label}のファイルではありません（format が ${expectedFormat} ではありません）` }],
    };
  }
  if (data.version !== EXCHANGE_VERSION) {
    return {
      ok: false,
      issues: [
        {
          path: 'version',
          code: 'unsupported_version',
          message: `対応していないバージョンです（対応: ${EXCHANGE_VERSION}、値: ${JSON.stringify(data.version) ?? 'なし'}）`,
        },
      ],
    };
  }
  const ctx: Ctx = { issues: [] };
  const value = root(data, '', ctx);
  return ctx.issues.length > 0 ? { ok: false, issues: ctx.issues } : { ok: true, value: value as T };
}

export function parseImportFile(text: string): ParseResult<ImportFileV1> {
  return parseWith<ImportFileV1>(text, EXCHANGE_FORMAT.import, '取込用', importRoot);
}

export function parseExportFile(text: string): ParseResult<ExportFileV1> {
  return parseWith<ExportFileV1>(text, EXCHANGE_FORMAT.export, '出力用', exportRoot);
}
