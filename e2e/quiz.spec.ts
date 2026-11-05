import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OWNER_EMAIL, OWNER_PASSWORD, loginAsOwner, loginHeading } from './helpers';

// quiz-session の利用者経路: 範囲選択 → 解答 → 判定表示 → フラグ → 終了、記録・取得の失敗と再試行、
// レスポンシブ・キーボード・ダークテーマ・導線を、画面から確認する（mobile と desktop の両方で実行）。
// 問題はこのファイルが実行ごとに作る科目にだけ作り、seed の問題には解答を作らない。
// 解答・SRS・フラグは FK が on delete restrict のため、後片付けで子テーブルを先に消してから科目を消す。

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const NAME_PREFIX = 'quiz-ui-';
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_ai-question-study';
const RECORD_RPC = '**/rest/v1/rpc/record_answer*';
const CANDIDATES_RPC = '**/rest/v1/rpc/list_quiz_candidates*';
const FLAGS_RPC = '**/rest/v1/rpc/save_question_flags*';

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

// テスト用の SQL 接続（postgres として psql を実行する）
function sqlOk(script: string): string[] {
  try {
    const out = execFileSync(
      'docker',
      [
        'exec',
        '-i',
        DB_CONTAINER,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-X',
        '-q',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return out.split(/\r?\n/).filter((l) => l.length > 0);
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(err.stderr ?? err.message);
  }
}

// このファイルが作った科目の解答・SRS・フラグをトリガーを止めて消し、科目ごと物理削除する
function cleanupSubjects(): void {
  sqlOk(`begin;
set local session_replication_role = replica;
create temp table t_q on commit drop as
  select q.id from public.questions q join public.subjects s on s.id = q.subject_id
  where s.owner_id = '${OWNER_ID}' and s.name like '${NAME_PREFIX}%';
delete from public.answers where question_id in (select id from t_q);
delete from public.srs_states where question_id in (select id from t_q);
delete from public.question_flags where question_id in (select id from t_q);
set local session_replication_role = origin;
delete from public.subjects where owner_id = '${OWNER_ID}' and name like '${NAME_PREFIX}%';
commit;`);
}

function answerCount(questionId: string): number {
  return Number(sqlOk(`select count(*) from public.answers where question_id = '${questionId}';`)[0]);
}

function openFlags(questionId: string): string[] {
  return sqlOk(
    `select flag || coalesce(':' || note, '') from public.question_flags
     where question_id = '${questionId}' and status = 'open' order by flag;`,
  );
}

// ---- データ作成（所有者の supabase-js と save_question RPC） ----

let owner: SupabaseClient;
let run = '';

async function createSubject(name: string): Promise<{ id: string; name: string }> {
  const full = `${run}-${name}`;
  const { data, error } = await owner.from('subjects').insert({ name: full }).select('id').single();
  if (error) throw error;
  return { id: data.id as string, name: full };
}

async function createKeyword(subjectId: string, name: string, parentId: string | null = null): Promise<string> {
  const { data, error } = await owner
    .from('keywords')
    .insert({ subject_id: subjectId, parent_id: parentId, name })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

// 選択肢は「<stem>の正解」（正解）と「<stem>の誤答」。作成順を一意にするため1問ずつ作る
async function createQuestion(subjectId: string, stem: string, keywordIds: string[]): Promise<string> {
  const { data, error } = await owner.rpc('save_question', {
    p: {
      id: null,
      subjectId,
      kind: 'keyword',
      stem,
      explanation: `${stem}の全体解説`,
      keywordIds,
      choices: [
        { body: `${stem}の正解`, explanation: `${stem}の正解の解説`, isCorrect: true },
        { body: `${stem}の誤答`, explanation: `${stem}の誤答の解説`, isCorrect: false },
      ],
    },
  });
  if (error) throw error;
  return data as string;
}

type FlowData = {
  subject: { id: string; name: string };
  mid: string;
  empty: string;
  q: Record<'q1' | 'q2' | 'q3', string>;
};
let flow: FlowData;
let flagsSubject: { id: string; name: string };
let flagsQuestion: string;
let retrySubject: { id: string; name: string };
let retryQuestion: string;
let uiSubject: { id: string; name: string };

test.beforeAll(async ({}, testInfo) => {
  run = `${NAME_PREFIX}${testInfo.project.name}-${Date.now()}`;
  cleanupSubjects();
  const { url, key } = loadEnv();
  owner = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await owner.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  if (error) throw error;

  // 親 > 中 > 葉 と、問題のない「空」。問4 は無効化、問5 は削除、問6 は親だけに紐づく（中の範囲外）
  const subject = await createSubject('流れ');
  const parent = await createKeyword(subject.id, '親');
  const mid = await createKeyword(subject.id, '中', parent);
  const leaf = await createKeyword(subject.id, '葉', mid);
  const empty = await createKeyword(subject.id, '空');
  const q1 = await createQuestion(subject.id, '問1', [mid]);
  const q2 = await createQuestion(subject.id, '問2', [leaf]);
  const q3 = await createQuestion(subject.id, '問3', [mid, leaf]);
  const q4 = await createQuestion(subject.id, '問4', [leaf]);
  const q5 = await createQuestion(subject.id, '問5', [mid]);
  await createQuestion(subject.id, '問6', [parent]);
  const now = new Date().toISOString();
  const d1 = await owner.from('questions').update({ disabled_at: now }).eq('id', q4);
  if (d1.error) throw d1.error;
  const d2 = await owner.from('questions').update({ deleted_at: now }).eq('id', q5);
  if (d2.error) throw d2.error;
  flow = { subject, mid, empty, q: { q1, q2, q3 } };

  flagsSubject = await createSubject('フラグ');
  const fk = await createKeyword(flagsSubject.id, 'フラグ語');
  flagsQuestion = await createQuestion(flagsSubject.id, '旗問', [fk]);

  retrySubject = await createSubject('再試行');
  const rk = await createKeyword(retrySubject.id, '再試行語');
  retryQuestion = await createQuestion(retrySubject.id, '再問', [rk]);

  uiSubject = await createSubject('表示');
  const uk = await createKeyword(uiSubject.id, '表示語');
  await createQuestion(uiSubject.id, '表示問', [uk]);
});

test.afterAll(async () => {
  await owner?.auth.signOut();
  cleanupSubjects();
});

// ---- 画面操作の補助 ----

const startButton = (page: Page) => page.getByRole('button', { name: '開始', exact: true });
const nextButton = (page: Page) => page.getByRole('button', { name: '次へ', exact: true });
const treeItem = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
const choiceItem = (page: Page, body: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('button', { name: body, exact: true }) });
const statsBar = (page: Page) => page.getByText(/^正答 \d+ \/ 出題 \d+（.+）$/);

async function openStart(page: Page, subjectName: string): Promise<void> {
  await page.goto('/quiz');
  await expect(page.getByRole('heading', { name: '出題範囲の選択' })).toBeVisible();
  await page.getByRole('button', { name: subjectName, exact: true }).click();
  await expect(treeItem(page, '科目全体')).toBeVisible();
}

async function openPlay(page: Page, subjectId: string): Promise<void> {
  await page.goto(`/quiz/play?subject=${subjectId}`);
}

async function waitSaved(page: Page): Promise<void> {
  await expect(nextButton(page)).toBeEnabled();
}

// 判定後の右端の列: 「？」と同じ 44px 幅で、正誤の記号（読み上げ用の文言）を持つ（5.9）
async function expectMark(page: Page, body: string, label: '正解' | '不正解'): Promise<void> {
  const cell = choiceItem(page, body).getByTestId('mark-cell');
  await expect(cell).toHaveText(label);
  const box = (await cell.boundingBox())!;
  expect(Math.round(box.width)).toBe(44);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectFocusRing(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  const s = await locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
  });
  expect(s.style).not.toBe('none');
  expect(s.width).toBeGreaterThanOrEqual(2);
}

// Tab を押し続けて target にフォーカスが届くことを確認する
async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('Tab でフォーカスが届きませんでした');
}

test.beforeEach(async ({ page }) => {
  await loginAsOwner(page);
});

test.describe('範囲選択から終了まで', () => {
  test('途中ノードの件数、0件で開始不可、未出題順の出題、各解答の表示、終了表示', async ({ page }) => {
    await openStart(page, flow.subject.name);

    // 科目全体は無効・削除を除く4問（1.1、1.3、1.8）
    await expect(page.getByText('出題対象 4 問（未出題 4 問）')).toBeVisible();

    // 途中ノード「中」は配下の葉を含み、重複なく3問（1.2、1.4）
    await treeItem(page, '親').click();
    await page.keyboard.press('ArrowRight');
    await expect(treeItem(page, '中')).toBeVisible();
    await treeItem(page, '空').click();
    await expect(page.getByText('この範囲には出題できる問題がありません')).toBeVisible();
    await expect(startButton(page)).toBeDisabled(); // 1.6

    await treeItem(page, '中').click();
    await expect(treeItem(page, '中')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('出題対象 3 問（未出題 3 問）')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`keyword=${flow.mid}`));
    await startButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/quiz/play\\?.*keyword=${flow.mid}`));

    // 問1（作成順で最初の未出題）: 判定前は印・解説・フラグなし、未出題の成績（2.1、5.7、6.3）
    await expect(page.getByRole('heading', { name: '問1', exact: true })).toBeVisible();
    await expect(statsBar(page)).toHaveText('正答 0 / 出題 0（未出題）');
    await expect(page.getByText('問1の正解の解説')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '解説' })).toHaveCount(0);
    await expect(nextButton(page)).toBeDisabled();

    // 正解（5.1、5.4〜5.6、6.1、6.2）
    await page.getByRole('button', { name: '問1の正解', exact: true }).click();
    const c1 = choiceItem(page, '問1の正解');
    await expect(c1).toHaveClass(/mark-correct/);
    await expect(c1).toHaveClass(/choice-selected/);
    await expect(c1.getByText('正解', { exact: true })).toBeAttached();
    await expect(choiceItem(page, '問1の誤答')).not.toHaveClass(/mark-/);
    await expect(page.getByRole('button', { name: /^推測で解答/ })).toHaveCount(0);
    await expectMark(page, '問1の正解', '正解');
    await expect(choiceItem(page, '問1の誤答').getByTestId('mark-cell')).toHaveText('');
    await expect(page.getByText('問1の正解の解説')).toBeVisible();
    await expect(page.getByText('問1の誤答の解説')).toBeVisible();
    const fb1 = page.getByRole('region', { name: '解説' });
    await expect(fb1.getByText('問1の全体解説')).toBeVisible();
    await expect(fb1.getByText('親 / 中', { exact: true })).toBeVisible();
    await expect(statsBar(page)).toHaveText('正答 1 / 出題 1（100%）');
    await expect(page.getByRole('button', { name: '問1の誤答', exact: true })).toBeDisabled();
    await waitSaved(page);
    await expect(page.getByRole('region', { name: '問題フラグ' })).toBeVisible();
    await nextButton(page).click();

    // 問2: 誤答 → 選んだ誤答に ×、正解に ○（5.2、5.4）
    await expect(page.getByRole('heading', { name: '問2', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '問2の誤答', exact: true }).click();
    const w2 = choiceItem(page, '問2の誤答');
    await expect(w2).toHaveClass(/mark-incorrect/);
    await expect(w2).toHaveClass(/choice-selected/);
    await expect(w2.getByText('不正解', { exact: true })).toBeAttached();
    await expect(choiceItem(page, '問2の正解')).toHaveClass(/mark-correct/);
    await expect(page.getByRole('button', { name: /^推測で解答/ })).toHaveCount(0);
    await expectMark(page, '問2の誤答', '不正解');
    await expectMark(page, '問2の正解', '正解');
    await expect(page.getByRole('region', { name: '解説' }).getByText('親 / 中 / 葉', { exact: true })).toBeVisible();
    await expect(statsBar(page)).toHaveText('正答 0 / 出題 1（0%）');
    await waitSaved(page);
    await nextButton(page).click();

    // 問3: 「？」エリアで正解を推測 → 正誤表示、2つのキーワードの階層パス、guessable が選択済み（4.2、4.4、4.6、7.3、7.7）
    await expect(page.getByRole('heading', { name: '問3', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '推測で解答: 問3の正解', exact: true }).click();
    await expect(choiceItem(page, '問3の正解')).toHaveClass(/mark-correct/);
    await expect(choiceItem(page, '問3の正解')).toHaveClass(/choice-selected/);
    const fb3 = page.getByRole('region', { name: '解説' });
    await expect(fb3.getByText('親 / 中', { exact: true })).toBeVisible();
    await expect(fb3.getByText('親 / 中 / 葉', { exact: true })).toBeVisible();
    await expect(statsBar(page)).toHaveText('正答 1 / 出題 1（100%）');
    await waitSaved(page);
    await expect(page.getByRole('checkbox', { name: '知識がなくても推測で解ける' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: '問う価値が低い' })).not.toBeChecked();
    expect(openFlags(flow.q.q3)).toEqual(['guessable']);
    await nextButton(page).click();

    // 全問解答で終了表示（2.5）
    await expect(page.getByText('3 問解答、正答 2 問')).toBeVisible();
    expect(answerCount(flow.q.q1) + answerCount(flow.q.q2) + answerCount(flow.q.q3)).toBe(3);

    // 範囲選択へ戻ると範囲が保たれ、未出題は0（10.6）
    await page.getByRole('link', { name: '範囲選択へ戻る' }).click();
    await expect(treeItem(page, '中')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('出題対象 3 問（未出題 0 問）')).toBeVisible();
  });

  test('「わからない」の ○×、フラグの自動保存・空白コメント・次へ直前の入力・再読み込み後の選択済み・保存失敗と再試行', async ({
    page,
  }) => {
    let flagRequests = 0;
    page.on('request', (r) => {
      if (r.url().includes('/rest/v1/rpc/save_question_flags')) flagRequests++;
    });
    const flagsOf = () => expect.poll(() => openFlags(flagsQuestion));
    await openPlay(page, flagsSubject.id);
    await expect(page.getByRole('heading', { name: '旗問', exact: true })).toBeVisible();

    // 「わからない」: わからないの列に ×、正解の列に ○、「？」は消え、成績は 0 / 1（4.3、4.6、5.3、5.9、6.2）
    await page.getByRole('button', { name: 'わからない', exact: true }).click();
    const unknown = choiceItem(page, 'わからない');
    await expect(unknown).toHaveClass(/mark-incorrect/);
    await expect(unknown).toHaveClass(/choice-selected/);
    await expect(choiceItem(page, '旗問の正解')).toHaveClass(/mark-correct/);
    await expect(page.getByRole('button', { name: /^推測で解答/ })).toHaveCount(0);
    await expectMark(page, 'わからない', '不正解');
    await expectMark(page, '旗問の正解', '正解');
    await expect(choiceItem(page, '旗問の誤答').getByTestId('mark-cell')).toHaveText('');
    await expect(page.getByText('旗問の全体解説')).toBeVisible();
    await expect(page.getByRole('region', { name: '解説' }).getByText('フラグ語', { exact: true })).toBeVisible();
    await expect(statsBar(page)).toHaveText('正答 0 / 出題 1（0%）');
    await waitSaved(page);

    // 保存ボタンはなく、チェックの操作だけで記録され、外すと消える（7.2、7.4、7.9）
    const form = page.getByRole('region', { name: '問題フラグ' });
    const lowValue = page.getByRole('checkbox', { name: '問う価値が低い' });
    const defective = page.getByRole('checkbox', { name: /^問題不備/ });
    const comment = page.getByLabel('疑義の内容（自由入力）');
    await expect(page.getByRole('button', { name: 'フラグを保存' })).toHaveCount(0);
    await expect(lowValue).not.toBeChecked();
    await lowValue.check();
    await flagsOf().toEqual(['low_value']);
    await defective.check();
    await flagsOf().toEqual(['defective', 'low_value']);
    await defective.uncheck();
    await flagsOf().toEqual(['low_value']);
    await expect(form.getByText('保存しました')).toBeVisible();

    // 自由入力は blur で記録され、同じ内容の再 blur では保存要求を出さない（7.2、7.10）
    await comment.fill('  選択肢が曖昧  ');
    await comment.blur();
    await flagsOf().toEqual(['comment:選択肢が曖昧', 'low_value']);
    const before = flagRequests;
    await comment.focus();
    await comment.blur();
    await defective.check(); // 次の保存要求を目印にして、再 blur の分が送られていないことを確かめる
    await flagsOf().toEqual(['comment:選択肢が曖昧', 'defective', 'low_value']);
    expect(flagRequests).toBe(before + 1);

    // 空白だけで blur するとコメントは消える（7.5）
    await comment.fill('  　 ');
    await comment.blur();
    await flagsOf().toEqual(['defective', 'low_value']);

    // 再読み込み後、同じ問題を解くと選択済みで表示される（7.7）
    await page.reload();
    await expect(page.getByRole('heading', { name: '旗問', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '旗問の正解', exact: true }).click();
    await expect(statsBar(page)).toHaveText('正答 1 / 出題 2（50%）');
    await waitSaved(page);
    await expect(lowValue).toBeChecked();
    await expect(defective).toBeChecked();
    await expect(comment).toHaveValue('');

    // textarea にフォーカスしたまま「次へ」を押しても入力が記録されてから遷移する（7.6、7.10）
    await comment.fill('すぐ次へ');
    await expect(comment).toBeFocused();
    await nextButton(page).click();
    await expect(page.getByText(/^\d+ 問解答、正答 \d+ 問$/)).toBeVisible();
    expect(openFlags(flagsQuestion)).toEqual(['comment:すぐ次へ', 'defective', 'low_value']);

    // 保存の通信を1回だけ遮断: 入力は保持され、失敗と再試行が出て「次へ」で遷移しない。再試行で記録される（7.6）
    await page.reload();
    await expect(page.getByRole('heading', { name: '旗問', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '旗問の誤答', exact: true }).click();
    await waitSaved(page);
    await expect(defective).toBeChecked();
    await page.route(FLAGS_RPC, (route) => route.abort('failed'), { times: 1 });
    await defective.uncheck();
    const alert = form.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: '再試行' })).toBeVisible();
    await expect(defective).not.toBeChecked();
    await expect(comment).toHaveValue('すぐ次へ');
    expect(openFlags(flagsQuestion)).toEqual(['comment:すぐ次へ', 'defective', 'low_value']);
    await nextButton(page).click();
    await expect(alert).toBeVisible();
    await expect(page.getByRole('heading', { name: '旗問', exact: true })).toBeVisible();
    await expect(page.getByText(/問解答、正答/)).toHaveCount(0);
    await alert.getByRole('button', { name: '再試行' }).click();
    await flagsOf().toEqual(['comment:すぐ次へ', 'low_value']);
    await expect(form.getByRole('alert')).toHaveCount(0);
    await nextButton(page).click();
    await expect(page.getByText(/^\d+ 問解答、正答 \d+ 問$/)).toBeVisible();
  });
});

test.describe('失敗と再試行', () => {
  test('候補の取得失敗と再試行、記録の失敗で次へ無効、再試行で1件だけ記録、終了で範囲選択に戻る', async ({ page }) => {
    // 候補の取得を遮断（10.5）
    await page.route(CANDIDATES_RPC, (route) => route.abort('failed'));
    await openPlay(page, retrySubject.id);
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await page.unroute(CANDIDATES_RPC);
    await page.getByRole('button', { name: '再試行' }).click();
    await expect(page.getByRole('heading', { name: '再問', exact: true })).toBeVisible();

    // 記録を遮断（3.3、3.5）
    let blocked = 0;
    await page.route(RECORD_RPC, (route) => {
      blocked++;
      return route.abort('failed');
    });
    await page.getByRole('button', { name: '再問の正解', exact: true }).click();
    await expect(page.getByText('解答を記録できませんでした')).toBeVisible();
    await expect(nextButton(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: '再問の誤答', exact: true })).toBeDisabled();
    expect(blocked).toBeGreaterThan(0);
    expect(answerCount(retryQuestion)).toBe(0);

    // 再試行で同じ冪等キーを送り、1件だけ記録される（3.4）
    await page.unroute(RECORD_RPC);
    await page.getByRole('button', { name: '再試行' }).click();
    await waitSaved(page);
    await expect(page.getByText('解答を記録できませんでした')).toHaveCount(0);
    expect(answerCount(retryQuestion)).toBe(1);

    // 終了で同じ範囲の範囲選択に戻り、記録済みの解答が残る（10.6）
    await page.getByRole('button', { name: '終了', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/quiz\\?subject=${retrySubject.id}`));
    await expect(page.getByRole('button', { name: retrySubject.name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(treeItem(page, '科目全体')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('出題対象 1 問（未出題 0 問）')).toBeVisible();
    expect(answerCount(retryQuestion)).toBe(1);
  });
});

test.describe('レスポンシブ・キーボード・テーマ・導線', () => {
  test('横スクロールなし、「？」エリアと選択領域が 44px 以上で重ならず、同じ操作で解答できる', async ({ page }) => {
    await openStart(page, uiSubject.name);
    await expectNoHorizontalScroll(page);
    await startButton(page).click();
    await expect(page.getByRole('heading', { name: '表示問', exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);

    for (const body of ['表示問の正解', '表示問の誤答']) {
      const main = (await page.getByRole('button', { name: body, exact: true }).boundingBox())!;
      const guess = (await page.getByRole('button', { name: `推測で解答: ${body}`, exact: true }).boundingBox())!;
      for (const b of [main, guess]) {
        expect(b.width).toBeGreaterThanOrEqual(44);
        expect(b.height).toBeGreaterThanOrEqual(44);
      }
      // 選択領域は「？」エリアより左にあり、重ならない（4.6、10.3、10.4）
      expect(main.x + main.width).toBeLessThanOrEqual(guess.x);
    }
    const unknown = (await page.getByRole('button', { name: 'わからない', exact: true }).boundingBox())!;
    expect(unknown.height).toBeGreaterThanOrEqual(44);

    await page.getByRole('button', { name: '表示問の誤答', exact: true }).click();
    await waitSaved(page);
    await expectNoHorizontalScroll(page);
    for (const box of await page.getByRole('checkbox').all()) {
      const label = (await box.locator('xpath=ancestor::label').boundingBox())!;
      expect(label.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('Tab で範囲選択・選択肢・「？」・次へに到達でき、フォーカス表示が見える', async ({ page }) => {
    await openStart(page, uiSubject.name);
    await tabTo(page, treeItem(page, '科目全体'));
    await expectFocusRing(treeItem(page, '科目全体'));
    await tabTo(page, startButton(page));
    await expectFocusRing(startButton(page));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '表示問', exact: true })).toBeVisible();

    const guess = page.getByRole('button', { name: '推測で解答: 表示問の正解', exact: true });
    await tabTo(page, page.getByRole('button', { name: '表示問の正解', exact: true }));
    await expectFocusRing(page.getByRole('button', { name: '表示問の正解', exact: true }));
    await page.keyboard.press('Tab');
    await expectFocusRing(guess);
    await tabTo(page, page.getByRole('button', { name: 'わからない', exact: true }));
    await expectFocusRing(page.getByRole('button', { name: 'わからない', exact: true }));
    await page.keyboard.press('Enter');
    await waitSaved(page);

    await tabTo(page, page.getByRole('checkbox', { name: '問う価値が低い' }));
    await expectFocusRing(page.getByRole('checkbox', { name: '問う価値が低い' }));
    await tabTo(page, nextButton(page));
    await expectFocusRing(nextButton(page));
  });

  test('ダークテーマでトークンの色が切り替わる', async ({ page }) => {
    const colors = async () =>
      page.evaluate(() => {
        const pick = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error(sel);
          const cs = getComputedStyle(el);
          return { bg: cs.backgroundColor, color: cs.color };
        };
        return {
          body: pick('body'),
          correct: pick('.mark-correct'),
          incorrect: pick('.mark-incorrect'),
          bgToken: getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim(),
        };
      });

    const judgeOnce = async () => {
      await openPlay(page, uiSubject.id);
      await expect(page.getByRole('heading', { name: '表示問', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '表示問の誤答', exact: true }).click();
      await expect(page.locator('.mark-incorrect')).toHaveCount(1);
    };

    await page.emulateMedia({ colorScheme: 'light' });
    await judgeOnce();
    const light = await colors();
    await waitSaved(page);

    await page.emulateMedia({ colorScheme: 'dark' });
    await judgeOnce();
    const dark = await colors();
    await waitSaved(page);
    await expectNoHorizontalScroll(page);

    expect(light.bgToken).toBe('#ffffff');
    expect(dark.bgToken).toBe('#0c0a09');
    expect(dark.body.bg).toBe('rgb(12, 10, 9)');
    expect(dark.body.bg).not.toBe(light.body.bg);
    expect(dark.body.color).not.toBe(light.body.color);
    expect(dark.correct.bg).not.toBe(light.correct.bg);
    expect(dark.incorrect.bg).not.toBe(light.incorrect.bg);
    // 正解と不正解の色は区別できる
    expect(dark.correct.bg).not.toBe(dark.incorrect.bg);
  });

  test('学習区分の「出題」導線（PC はサイドナビ、モバイルは下部バー）から範囲選択を開ける', async ({
    page,
  }, testInfo) => {
    const navName = testInfo.project.name === 'desktop' ? 'サイドナビゲーション' : '学習ナビゲーション';
    const nav = page.getByRole('navigation', { name: navName, exact: true });
    await expect(nav).toBeVisible();
    await nav.getByRole('link', { name: '出題', exact: true }).click();
    await expect(page.getByRole('heading', { name: '出題範囲の選択' })).toBeVisible();
    await expect(page).toHaveURL(/\/quiz(\?|$)/);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('未ログイン', () => {
  test('範囲選択と解答画面はログイン画面へ遷移する', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const page = await ctx.newPage();
    await page.goto('/quiz');
    await expect(loginHeading(page)).toBeVisible();
    await page.goto(`/quiz/play?subject=${uiSubject.id}`);
    await expect(loginHeading(page)).toBeVisible();
    await ctx.close();
  });
});
