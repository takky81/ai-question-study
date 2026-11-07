import { describe, expect, it } from 'vitest';
import { extractTerms, lintQuestion, type LintKind } from './guessLint.ts';
import type { AuthoredQuestion } from './importModel.ts';

// choices の先頭を正解にする
const q = (stem: string, bodies: string[], kind: 'keyword' | 'feature' = 'feature', correct = 0): AuthoredQuestion => ({
  ref: 'q1',
  kind,
  stem,
  explanation: '',
  choices: bodies.map((body, i) => ({ body, explanation: '', isCorrect: i === correct })),
});

const kinds = (question: AuthoredQuestion, k: LintKind) => lintQuestion(question).filter((w) => w.kind === k);

describe('extractTerms', () => {
  it('漢字・カタカナ・英数字の連続から2文字以上の語を取り出す', () => {
    const terms = extractTerms('仮想記憶のページング方式とTLB');
    expect(terms).toContain('仮想記憶');
    expect(terms).toContain('記憶');
    expect(terms).toContain('ページング');
    expect(terms).toContain('TLB');
    expect(terms).not.toContain('TL'); // 英数字は語単位
    expect(terms).not.toContain('の');
  });
});

describe('stem_overlap', () => {
  it('正解だけが問題文と長い語を共有すると警告する', () => {
    const w = kinds(
      q('仮想記憶で主記憶が不足したときに起こる現象はどれか。', [
        '仮想記憶のスラッシング',
        'キャッシュミス',
        'デッドロック',
        'オーバーフロー',
      ]),
      'stem_overlap',
    );
    expect(w).toHaveLength(1);
    expect(w[0]?.choiceIndex).toBe(0);
    expect(w[0]?.terms).toContain('仮想記憶');
  });
  it('誤答も同程度に問題文と重なるときは警告しない', () => {
    const w = kinds(
      q('仮想記憶で主記憶が不足したときに起こる現象はどれか。', [
        '仮想記憶のスラッシング',
        '仮想記憶のフラグメンテーション',
        'デッドロック',
        'オーバーフロー',
      ]),
      'stem_overlap',
    );
    expect(w).toHaveLength(0);
  });
  it('一般語だけの重なりは警告しない', () => {
    const w = kinds(
      q('データの処理方式として適切なものはどれか。', ['バッチ処理', 'リアルタイム', 'オンライン', 'ストリーム']),
      'stem_overlap',
    );
    expect(w).toHaveLength(0);
  });
});

describe('length_outlier', () => {
  const long = 'ハードウェア上で直接ハイパーバイザが動作し、ホストOSを必要としない';
  it('feature 型で正解だけが長いと警告する', () => {
    const w = kinds(q('特徴はどれか。', [long, '処理が速い', '費用が安い', '設定が楽']), 'length_outlier');
    expect(w).toHaveLength(1);
    expect(w[0]?.choiceIndex).toBe(0);
  });
  it('keyword 型では警告しない', () => {
    expect(kinds(q('何か。', [long, 'RAID', 'NAS', 'SAN'], 'keyword'), 'length_outlier')).toHaveLength(0);
  });
  it('長さがそろっていれば警告しない', () => {
    expect(
      kinds(q('特徴はどれか。', ['処理が速い', '費用が安い', '設定が楽だ', '保守が楽だ']), 'length_outlier'),
    ).toHaveLength(0);
  });
});

describe('form_outlier', () => {
  it('1つだけ語尾が異なる選択肢を警告する（誤答でも）', () => {
    const w = kinds(
      q('説明はどれか。', ['データを暗号化する', 'データを圧縮する', '通信を中継する', '鍵の管理方式']),
      'form_outlier',
    );
    expect(w).toHaveLength(1);
    expect(w[0]?.choiceIndex).toBe(3);
  });
  it('語尾がそろっていれば警告しない', () => {
    expect(
      kinds(
        q('説明はどれか。', ['データを暗号化する', 'データを圧縮する', '通信を中継する', '鍵を配送する']),
        'form_outlier',
      ),
    ).toHaveLength(0);
  });
  it('語尾がばらばらなら警告しない', () => {
    expect(kinds(q('どれか。', ['RAID', 'ミラーリング', '冗長化', 'パリティ']), 'form_outlier')).toHaveLength(0);
  });
});

describe('absolute_word', () => {
  it('断定語が誤答にだけ現れると警告する', () => {
    const w = kinds(
      q('特徴はどれか。', ['障害時に縮退運転できる', '必ずデータが失われない', '常に高速に動く', '費用が安い']),
      'absolute_word',
    );
    expect(w.map((x) => x.choiceIndex)).toEqual([1, 2]);
    expect(w[0]?.terms).toEqual(['必ず']);
  });
  it('正解にも断定語があれば警告しない', () => {
    expect(
      kinds(
        q('特徴はどれか。', ['すべての書込みを記録する', '必ずデータが失われない', '費用が安い', '設定が楽']),
        'absolute_word',
      ),
    ).toHaveLength(0);
  });
});

describe('containment', () => {
  it('ある選択肢が別の選択肢を含むと警告する', () => {
    const w = kinds(q('どれか。', ['公開鍵暗号方式', '公開鍵', '共通鍵', 'ハッシュ']), 'containment');
    expect(w).toHaveLength(1);
    expect(w[0]?.choiceIndex).toBe(0);
    expect(w[0]?.terms).toEqual(['公開鍵']);
  });
  it('含む関係がなければ警告しない', () => {
    expect(kinds(q('どれか。', ['公開鍵暗号', '共通鍵暗号', 'ハッシュ関数', '電子署名']), 'containment')).toHaveLength(
      0,
    );
  });
});

describe('full_name', () => {
  it('略語のフルネームが選択肢に現れると警告する', () => {
    const w = kinds(
      q('CPI の説明はどれか。', ['Cycles Per Instruction の略', '命令の数', 'クロックの周波数', '処理の時間']),
      'full_name',
    );
    expect(w).toHaveLength(1);
    expect(w[0]?.choiceIndex).toBe(0);
    expect(w[0]?.terms).toEqual(['CPI', 'Cycles Per Instruction']);
  });
  it('フルネームがなければ警告しない', () => {
    expect(
      kinds(
        q('CPI の説明はどれか。', ['1命令あたりのクロック数', '命令の数', 'Clock Rate', '処理の時間']),
        'full_name',
      ),
    ).toHaveLength(0);
  });
});

it('問題のない問題は警告がない', () => {
  expect(
    lintQuestion(
      q('RAID 1 の特徴はどれか。', [
        'ミラーリングする',
        'パリティを分散する',
        'ストライピングする',
        '圧縮して保存する',
      ]),
    ),
  ).toEqual([]);
});
