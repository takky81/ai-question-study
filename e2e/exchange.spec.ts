import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OWNER_EMAIL, OWNER_PASSWORD, loginAsOwner } from './helpers';

// question-exchange（入出力）の E2E。
// 出力の describe は seed（「E2E 交換テスト」「E2E 交換大量データ」）を読むだけで、書き換えない。
// 取込など seed を変える describe は、実行ごとに接頭辞付きの自前データを作ること。
// 画面は PC 優先のため、画面操作の describe は desktop プロジェクトだけで実行する。

// ============================================================
// 共通の補助
// ============================================================

function loadEnv(): { url: string; key: string } {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m?.[1] !== undefined) env[m[1]] = m[2] ?? '';
    }
  } catch {
    // .env.local がなければ環境変数だけを使う
  }
  const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が必要です');
  return { url, key };
}

async function ownerClient(): Promise<SupabaseClient> {
  const { url, key } = loadEnv();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  if (error) throw error;
  return client;
}

// PC 優先の画面操作の describe は desktop だけで実行する（beforeAll での skip はグループ全体に効く）
function desktopOnly(): void {
  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'PC 優先の画面操作のため desktop で実行する');
  });
}

// seed の ID
const EX_SUBJECT = 'c0000000-0000-4000-8000-000000000001';
const BULK_SUBJECT = 'c0000000-0000-4000-8000-000000000002';
const kwId = (n: number) => `c0000000-0000-4000-8000-00000000c${n}`;
const qId = (n: number) => `c0000000-0000-4000-8000-00000000d00${n}`;

type ExportFile = {
  format: string;
  version: number;
  subject: { id: string; name: string };
  conditions: Record<string, unknown>;
  keywords: { id: string; path: string[] }[];
  questions: {
    id: string;
    status: 'active' | 'disabled';
    disabledReason: string | null;
    keywordIds: string[];
    choices: { id: string }[];
    openFlags: { flag: string; note: string | null }[];
  }[];
};

async function openExport(page: Page): Promise<Locator> {
  await loginAsOwner(page);
  await page.goto('/exchange');
  await expect(page.getByRole('heading', { level: 1, name: '入出力' })).toBeVisible();
  await page.getByRole('tab', { name: '出力' }).click();
  return page.getByRole('tabpanel', { name: '出力' });
}

async function selectSubject(panel: Locator, name: string): Promise<void> {
  const select = panel.getByLabel('科目', { exact: true });
  await expect(select).toBeEnabled();
  await select.selectOption({ label: name });
  await expect(panel.getByRole('tree', { name: '範囲' })).toBeVisible();
}

async function downloadExport(page: Page, panel: Locator): Promise<{ fileName: string; file: ExportFile }> {
  const button = panel.getByRole('button', { name: '出力', exact: true });
  await expect(button).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await download.path();
  const file = JSON.parse(readFileSync(path, 'utf8')) as ExportFile;
  return { fileName: download.suggestedFilename(), file };
}

const ids = (file: ExportFile) => file.questions.map((q) => q.id).sort();
const question = (file: ExportFile, id: string) => {
  const q = file.questions.find((x) => x.id === id);
  if (!q) throw new Error(`問題 ${id} が出力にありません`);
  return q;
};

// ============================================================
// 出力（1.3〜1.7、2.3〜2.9）
// ============================================================

test.describe('出力', () => {
  desktopOnly();

  test('途中のキーワードの範囲とフラグ条件で、配下の問題と未解消のフラグだけが出力される（1.3〜1.5、2.3〜2.8）', async ({
    page,
  }) => {
    const panel = await openExport(page);
    await selectSubject(panel, 'E2E 交換テスト');
    await panel.getByRole('treeitem', { name: 'ソート', exact: true }).click();
    await panel.getByRole('radio', { name: '未解消のフラグがある' }).check();
    await panel.getByLabel('正答率の下限（%）').fill('20');
    await expect(panel.getByText('2 問が一致します')).toBeVisible();

    const { fileName, file } = await downloadExport(page, panel);
    expect(fileName).toContain('E2E');
    expect(fileName.endsWith('.json')).toBe(true);
    expect(file.format).toBe('ai-question-study/export');
    expect(file.version).toBe(1);
    expect(file.subject).toEqual({ id: EX_SUBJECT, name: 'E2E 交換テスト' });
    expect(file.conditions).toMatchObject({ keywordId: kwId(102), flag: 'any', correctRateMin: 0.2, includeDisabled: false });
    // キーワード階層は範囲によらず全体を持つ（2.3）
    expect(file.keywords.map((k) => k.id).sort()).toEqual([101, 102, 103, 104, 105].map(kwId).sort());
    expect(file.keywords.find((k) => k.id === kwId(103))?.path).toEqual(['アルゴリズム', 'ソート', 'クイックソート']);

    // ソート配下・未解消フラグあり・正答率 20% 以上: d001（100%）と d002（25%）。d005 は無効なので含まれない
    expect(ids(file)).toEqual([qId(1), qId(2)]);
    expect(question(file, qId(1)).openFlags.map((f) => f.flag)).toEqual(['defective']);
    expect(question(file, qId(2)).openFlags).toEqual([expect.objectContaining({ flag: 'comment', note: 'E2E 用のコメント' })]);
    for (const q of file.questions) {
      expect(q.status).toBe('active');
      expect(q.choices).toHaveLength(4);
    }
  });

  test('正答率の範囲で絞り込まれ、解消済みのフラグは出力されない（1.6、1.7、2.5）', async ({ page }) => {
    const panel = await openExport(page);
    await selectSubject(panel, 'E2E 交換テスト');
    await panel.getByRole('treeitem', { name: 'ソート', exact: true }).click();
    await panel.getByLabel('正答率の下限（%）').fill('20');
    await panel.getByLabel('正答率の上限（%）').fill('60');
    await expect(panel.getByText('2 問が一致します')).toBeVisible();

    const { file } = await downloadExport(page, panel);
    // d002（25%）と d003（50%）。d001（100%）・d007（未解答）・d004（範囲外）・d006（削除）は含まれない
    expect(ids(file)).toEqual([qId(2), qId(3)]);
    // d003 のフラグは解消済みのため出力されない
    expect(question(file, qId(3)).openFlags).toEqual([]);
  });

  test('「無効化された問題を含める」で無効の問題が状態と理由付きで出力される（1.5、2.6）', async ({ page }) => {
    const panel = await openExport(page);
    await selectSubject(panel, 'E2E 交換テスト');
    await panel.getByRole('treeitem', { name: 'ソート', exact: true }).click();
    await panel.getByRole('radio', { name: '未解消のフラグがある' }).check();
    await expect(panel.getByText('2 問が一致します')).toBeVisible();
    await panel.getByRole('checkbox', { name: '無効化された問題を含める' }).check();
    await expect(panel.getByText('3 問が一致します')).toBeVisible();

    const { file } = await downloadExport(page, panel);
    expect(file.conditions).toMatchObject({ includeDisabled: true });
    expect(ids(file)).toEqual([qId(1), qId(2), qId(5)]);
    const disabled = question(file, qId(5));
    expect(disabled.status).toBe('disabled');
    expect(disabled.disabledReason).toBe('E2E 用の無効化');
    expect(disabled.keywordIds).toEqual([kwId(103)]);
    expect(disabled.openFlags.map((f) => f.flag)).toEqual(['low_value']);
    expect(question(file, qId(1)).status).toBe('active');
    // 削除済みの問題は含めても出力されない
    expect(file.questions.some((q) => q.id === qId(6))).toBe(false);
  });

  test('1,200 問・選択肢 4,800 件が欠落・重複なく DB と一致する（2.9）', async ({ page }) => {
    test.setTimeout(120_000);
    const db = await ownerClient();
    const dbQuestions: string[] = [];
    const dbChoices: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('questions')
        .select('id')
        .eq('subject_id', BULK_SUBJECT)
        .is('deleted_at', null)
        .is('disabled_at', null)
        .order('id')
        .range(from, from + 999);
      if (error) throw error;
      dbQuestions.push(...data.map((r) => r.id as string));
      if (data.length < 1000) break;
    }
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('choices')
        .select('id, questions!inner(subject_id)')
        .eq('questions.subject_id', BULK_SUBJECT)
        .is('removed_at', null)
        .order('id')
        .range(from, from + 999);
      if (error) throw error;
      dbChoices.push(...data.map((r) => r.id as string));
      if (data.length < 1000) break;
    }
    expect(dbQuestions).toHaveLength(1200);
    expect(dbChoices).toHaveLength(4800);

    const panel = await openExport(page);
    await selectSubject(panel, 'E2E 交換大量データ');
    await expect(panel.getByText('1200 問が一致します')).toBeVisible();
    const { file } = await downloadExport(page, panel);

    const qIds = file.questions.map((q) => q.id);
    const cIds = file.questions.flatMap((q) => q.choices.map((c) => c.id));
    expect(qIds).toHaveLength(1200);
    expect(new Set(qIds).size).toBe(1200);
    expect(cIds).toHaveLength(4800);
    expect(new Set(cIds).size).toBe(4800);
    expect([...qIds].sort()).toEqual([...dbQuestions].sort());
    expect([...cIds].sort()).toEqual([...dbChoices].sort());
  });
});

// ============================================================
// 取込・競合・フラグ解消（3.2〜3.6、5.1〜5.5、6.1〜6.6、7.1〜7.4、8.1〜8.5）
// seed は書き換えず、実行ごとに接頭辞付きの科目を作り、後片付けで消す。
// ============================================================

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const IMPORT_PREFIX = 'exchange-imp-';
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_ai-question-study';

// テスト用の SQL 接続（postgres として psql を実行する）
function sql(script: string): string[] {
  const out = execFileSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  return out.split(/\r?\n/).filter((l) => l.length > 0);
}

// 接頭辞の科目の解答・SRS・フラグをトリガーを止めて消し、科目ごと物理削除する
function cleanupImportSubjects(): void {
  sql(`begin;
set local session_replication_role = replica;
create temp table t_q on commit drop as
  select q.id from public.questions q join public.subjects s on s.id = q.subject_id
  where s.owner_id = '${OWNER_ID}' and s.name like '${IMPORT_PREFIX}%';
delete from public.answers where question_id in (select id from t_q);
delete from public.srs_states where question_id in (select id from t_q);
delete from public.question_flags where question_id in (select id from t_q);
set local session_replication_role = origin;
delete from public.subjects where owner_id = '${OWNER_ID}' and name like '${IMPORT_PREFIX}%';
commit;`);
}

type DbChoice = { id: string; body: string; explanation: string; is_correct: boolean; removed_at: string | null };
type Fixture = {
  db: SupabaseClient;
  subjectId: string;
  kw: { a: string; b: string; c: string };
  q: { id: string; choices: DbChoice[] }[];
};

const CHOICE_BODIES = ['正しい説明', '紛らわしい説明', '無関係な説明', '逆の説明'];
const stemOf = (n: number) => `取込テストの問題${n}の特徴として正しいものはどれか。`;
const explanationOf = (n: number) => `問題${n}の全体の解説。`;

async function fetchChoices(db: SupabaseClient, questionId: string): Promise<DbChoice[]> {
  const { data, error } = await db
    .from('choices')
    .select('id, body, explanation, is_correct, removed_at')
    .eq('question_id', questionId)
    .order('position');
  if (error) throw error;
  return data as DbChoice[];
}

// キーワード 親A（根）・親B（根）・子C（親A の子）と、子C に紐づく問題3問（各4択・未解消のフラグ付き）を作る
async function createFixture(label: string): Promise<Fixture> {
  const db = await ownerClient();
  const { data: s, error: se } = await db
    .from('subjects')
    .insert({ name: `${IMPORT_PREFIX}${Date.now()}-${label}` })
    .select('id')
    .single();
  if (se) throw se;
  const subjectId = s.id as string;
  const kwInsert = async (name: string, parentId: string | null) => {
    const { data, error } = await db
      .from('keywords')
      .insert({ subject_id: subjectId, parent_id: parentId, name })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  };
  const a = await kwInsert('親A', null);
  const b = await kwInsert('親B', null);
  const c = await kwInsert('子C', a);
  const q: Fixture['q'] = [];
  for (const n of [1, 2, 3]) {
    const { data, error } = await db.rpc('save_question', {
      p: {
        id: null,
        subjectId,
        kind: 'feature',
        stem: stemOf(n),
        explanation: explanationOf(n),
        keywordIds: [c],
        choices: CHOICE_BODIES.map((body, i) => ({ id: null, body, explanation: `${body}の解説。`, isCorrect: i === 0 })),
      },
    });
    if (error) throw error;
    const id = data as string;
    const { error: fe } = await db.rpc('save_question_flags', { p_question_id: id, p_flags: ['defective'], p_comment: null });
    if (fe) throw fe;
    q.push({ id, choices: await fetchChoices(db, id) });
  }
  return { db, subjectId, kw: { a, b, c }, q };
}

const toImportChoices = (choices: DbChoice[]) =>
  choices.map((c) => ({ id: c.id, body: c.body, explanation: c.explanation, isCorrect: c.is_correct }));

// 既存の問題の内容をそのまま取込の修正の形にする
const asUpdate = (f: Fixture, i: number) => ({
  id: f.q[i]!.id,
  kind: 'feature',
  stem: stemOf(i + 1),
  explanation: explanationOf(i + 1),
  keywords: [{ id: f.kw.c }],
  choices: toImportChoices(f.q[i]!.choices),
});

function importFileOf(f: Fixture, questions: Record<string, unknown>, keywords: Record<string, unknown> = {}) {
  return {
    format: 'ai-question-study/import',
    version: 1,
    subjectId: f.subjectId,
    basedOnExportedAt: null,
    keywords: { add: [], rename: [], move: [], ...keywords },
    questions: { update: [], create: [], disable: [], ...questions },
  };
}

function writeImportFile(name: string, content: unknown): string {
  const path = test.info().outputPath(name);
  writeFileSync(path, JSON.stringify(content, null, 2), 'utf8');
  return path;
}

async function openImport(page: Page): Promise<Locator> {
  await loginAsOwner(page);
  await page.goto('/exchange');
  await expect(page.getByRole('heading', { level: 1, name: '入出力' })).toBeVisible();
  await page.getByRole('tab', { name: '取込' }).click();
  return page.getByRole('tabpanel', { name: '取込' });
}

// 問題ごとのフラグの状態（open / resolved）の一覧
function flagStatuses(questionIds: string[]): Record<string, string[]> {
  const rows = sql(
    `select question_id || '|' || status from public.question_flags
     where question_id in (${questionIds.map((id) => `'${id}'`).join(',')}) order by question_id, status;`,
  );
  const map: Record<string, string[]> = {};
  for (const id of questionIds) map[id] = [];
  for (const r of rows) {
    const [id, status] = r.split('|');
    map[id!]!.push(status!);
  }
  return map;
}

type DbKeyword = { id: string; name: string; parent_id: string | null };
async function keywordsOf(f: Fixture): Promise<DbKeyword[]> {
  const { data, error } = await f.db.from('keywords').select('id, name, parent_id').eq('subject_id', f.subjectId);
  if (error) throw error;
  return data as DbKeyword[];
}

test.describe('取込・競合・フラグ解消', () => {
  desktopOnly();
  test.afterAll(() => cleanupImportSubjects());

  test('全操作を含むファイルをプレビューして適用すると、ID 不変・選択肢の履歴・新規 ID・修正分だけのフラグ解消が反映される（3.2〜3.6、5.1〜5.5、6.1〜6.6、8.1〜8.5）', async ({
    page,
  }) => {
    const f = await createFixture('all');
    const [q1, q2, q3] = f.q as [Fixture['q'][number], Fixture['q'][number], Fixture['q'][number]];
    const before1 = q1.choices;
    const removed = before1[3]!;
    // 問題1: 選択肢1の言い換え（同じ ID）、選択肢4を外し、意味の変わる新しい選択肢（ID なし）を追加
    const update1 = {
      ...asUpdate(f, 0),
      stem: '取込テストの問題1（修正後）の特徴として正しいものはどれか。',
      choices: [
        { id: before1[0]!.id, body: '正しい説明（言い換え）', explanation: before1[0]!.explanation, isCorrect: true },
        ...toImportChoices(before1.slice(1, 3)),
        { body: '意味の異なる新しい説明', explanation: '新しい誤答の解説。', isCorrect: false },
      ],
    };
    const file = importFileOf(
      f,
      {
        update: [update1, asUpdate(f, 1)], // 問題2は内容が同じ（変更なし）
        create: [
          {
            tempKey: 'q-new',
            kind: 'feature',
            stem: '取込テストの新しい問題の特徴として正しいものはどれか。',
            explanation: '新しい問題の全体の解説。',
            keywords: [{ tempKey: 'kw-d' }],
            choices: CHOICE_BODIES.map((body, i) => ({ body, explanation: `${body}の解説。`, isCorrect: i === 0 })),
          },
        ],
        disable: [{ id: q3.id, reason: 'E2E の無効化' }],
      },
      {
        add: [{ tempKey: 'kw-d', parent: { id: f.kw.a }, name: '追加D' }],
        rename: [{ id: f.kw.b, name: '改名B' }],
        move: [{ id: f.kw.c, parent: null }],
      },
    );

    const panel = await openImport(page);
    await panel.getByLabel('取込ファイル').setInputFiles(writeImportFile('all.json', file));

    // プレビューの件数（5.1）
    const counts = panel.getByRole('region', { name: '変更の件数' });
    await expect(counts).toBeVisible();
    for (const label of ['キーワードの追加', 'キーワードの改名', 'キーワードの移動', '問題の修正', '問題の新規作成', '問題の無効化']) {
      await expect(counts.locator('div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText('1');
    }
    // 差分（5.2〜5.5）
    await expect(panel.getByText('変更なし（1件）')).toBeVisible();
    await expect(panel.getByText('問題の修正（1件）')).toBeVisible();
    await expect(panel.getByText('意味の異なる新しい説明').first()).toBeAttached();
    await expect(panel.getByText('理由: E2E の無効化')).toBeAttached();
    await expect(panel.getByText('取込テストの新しい問題の特徴として正しいものはどれか。')).toBeAttached();

    const apply = panel.getByRole('button', { name: '適用する' });
    await expect(apply).toBeVisible();
    const ack = panel.getByRole('checkbox', { name: '警告を確認しました' });
    // 新しいデータで出力日時なしのため警告は出ない。出たら回帰として失敗させる
    await expect(ack).toHaveCount(0);
    await apply.click();
    const result = panel.getByRole('status', { name: '適用の結果' });
    await expect(result).toContainText('取込を適用しました');
    await expect(result).toContainText('問題の修正: 1件');
    await expect(result).toContainText('解消したフラグ: 1件');

    // 問題1: 選択肢1は同じ ID で言い換え、選択肢4は removed_at 付きで残り、新しい選択肢に新しい ID（6.2、6.3）
    const after1 = await fetchChoices(f.db, q1.id);
    const active1 = after1.filter((c) => c.removed_at === null);
    expect(active1).toHaveLength(4);
    expect(active1.find((c) => c.id === before1[0]!.id)?.body).toBe('正しい説明（言い換え）');
    expect(after1.find((c) => c.id === removed.id)?.removed_at).not.toBeNull();
    const addedChoice = active1.find((c) => c.body === '意味の異なる新しい説明');
    expect(addedChoice).toBeDefined();
    expect(before1.map((c) => c.id)).not.toContain(addedChoice!.id);

    // 問題: 既存の ID は不変、無効化が反映され、新規の問題に新しい ID（6.1、6.4）
    const { data: qs, error } = await f.db.from('questions').select('id, stem, disabled_at').eq('subject_id', f.subjectId);
    if (error) throw error;
    const rows = qs as { id: string; stem: string; disabled_at: string | null }[];
    expect(rows).toHaveLength(4);
    const byId = (id: string) => rows.find((r) => r.id === id);
    expect(byId(q1.id)?.stem).toBe(update1.stem);
    expect(byId(q2.id)?.stem).toBe(stemOf(2));
    expect(byId(q2.id)?.disabled_at).toBeNull();
    expect(byId(q3.id)?.disabled_at).not.toBeNull();
    const created = rows.find((r) => !f.q.some((q) => q.id === r.id))!;
    expect(created.stem).toBe('取込テストの新しい問題の特徴として正しいものはどれか。');

    // キーワード: 追加（親A の子）・改名・移動（根へ）。ID は不変（6.5）
    const kws = await keywordsOf(f);
    expect(kws).toHaveLength(4);
    expect(kws.find((k) => k.id === f.kw.b)?.name).toBe('改名B');
    expect(kws.find((k) => k.id === f.kw.c)?.parent_id).toBeNull();
    const kwD = kws.find((k) => k.name === '追加D');
    expect(kwD?.parent_id).toBe(f.kw.a);
    const { data: links, error: le } = await f.db.from('question_keywords').select('keyword_id').eq('question_id', created.id);
    if (le) throw le;
    expect((links as { keyword_id: string }[]).map((l) => l.keyword_id)).toEqual([kwD!.id]);

    // フラグ: 修正した問題1だけ解消、変更なしの問題2・無効化の問題3は未解消、新規の問題にはフラグなし（8.1〜8.5）
    const flags = flagStatuses([q1.id, q2.id, q3.id, created.id]);
    expect(flags[q1.id]).toEqual(['resolved']);
    expect(flags[q2.id]).toEqual(['open']);
    expect(flags[q3.id]).toEqual(['open']);
    expect(flags[created.id]).toEqual([]);
  });

  test('プレビュー後に別タブで問題を編集してから適用すると何も変わらず、再検証で新しい差分が出る（7.1〜7.4）', async ({ page }) => {
    const f = await createFixture('stale');
    const q1 = f.q[0]!;
    const importedStem = '取込で直した問題文として正しいものはどれか。';
    const file = importFileOf(
      f,
      { update: [{ ...asUpdate(f, 0), stem: importedStem }] },
      { add: [{ tempKey: 'kw-x', parent: null, name: '競合で追加しないキーワード' }] },
    );
    const panel = await openImport(page);
    await panel.getByLabel('取込ファイル').setInputFiles(writeImportFile('stale.json', file));
    const apply = panel.getByRole('button', { name: '適用する' });
    await expect(apply).toBeEnabled();

    // 別タブでの手動編集を supabase-js で再現する
    const otherStem = '別タブで直した問題文として正しいものはどれか。';
    const { error } = await f.db.rpc('save_question', {
      p: {
        id: q1.id,
        subjectId: f.subjectId,
        kind: 'feature',
        stem: otherStem,
        explanation: explanationOf(1),
        keywordIds: [f.kw.c],
        choices: toImportChoices(q1.choices),
      },
    });
    if (error) throw error;
    // 手動編集はフラグを解消しない前提で、編集後の状態を基準にする
    const flagsBefore = flagStatuses([q1.id])[q1.id];

    await apply.click();
    const alert = panel.getByRole('alert');
    await expect(alert).toContainText('プレビューの作成後にデータが変更されました。再検証してください');
    await expect(panel.getByRole('status', { name: '適用の結果' })).toHaveCount(0);

    // 何も変わっていない（問題文は別タブのまま、キーワード追加なし、フラグもそのまま）
    const { data: q, error: qe } = await f.db.from('questions').select('stem').eq('id', q1.id).single();
    if (qe) throw qe;
    expect((q as { stem: string }).stem).toBe(otherStem);
    expect((await keywordsOf(f)).map((k) => k.name)).not.toContain('競合で追加しないキーワード');
    expect(flagStatuses([q1.id])[q1.id]).toEqual(flagsBefore);

    // 再検証で、別タブの変更を変更前とする新しい差分が出る
    await alert.getByRole('button', { name: '再検証' }).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(panel.getByText(otherStem).first()).toBeAttached();
    await expect(panel.getByRole('button', { name: '適用する' })).toBeEnabled();
  });

  test('上流制約に違反するペイロードを直接 RPC に送ると、キーワード追加もフラグ解消もロールバックされる（6.6、8.4）', async () => {
    const f = await createFixture('rollback');
    const q1 = f.q[0]!;
    const { data: qrow, error: qe } = await f.db.from('questions').select('updated_at').eq('id', q1.id).single();
    if (qe) throw qe;
    const { error } = await f.db.rpc('apply_exchange_import', {
      p: {
        subjectId: f.subjectId,
        expected: { keywords: [], questions: [{ id: q1.id, updatedAt: (qrow as { updated_at: string }).updated_at }] },
        keywordAdds: [{ tempKey: 'kw-r', parentId: null, parentTempKey: null, name: 'ロールバックされるキーワード' }],
        keywordRenames: [],
        keywordMoves: [],
        // 正解を0個にして上流の one_correct_required（コミット時の検査）を起こす
        questionUpdates: [
          {
            input: {
              id: q1.id,
              subjectId: f.subjectId,
              kind: 'feature',
              stem: stemOf(1),
              explanation: explanationOf(1),
              keywordIds: [f.kw.c],
              choices: q1.choices.map((c) => ({ id: c.id, body: c.body, explanation: c.explanation, isCorrect: false })),
            },
          },
        ],
        questionCreates: [],
        questionDisables: [],
        modifiedQuestionIds: [q1.id],
      },
    });
    expect(error?.message).toBe('one_correct_required');
    expect((await keywordsOf(f)).map((k) => k.name)).not.toContain('ロールバックされるキーワード');
    expect(flagStatuses([q1.id])[q1.id]).toEqual(['open']);
    expect((await fetchChoices(f.db, q1.id)).filter((c) => c.is_correct)).toHaveLength(1);
  });
});
