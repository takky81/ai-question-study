import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractQuestions } from './importModel.ts';

const choice = (body: string, isCorrect = false) => ({ body, explanation: `${body}の解説`, isCorrect });

const base = (questions: unknown) => ({
  format: 'ai-question-study/import',
  version: 1,
  subjectId: 's',
  basedOnExportedAt: '2026-11-01T09:00:00.000Z',
  questions,
});

describe('extractQuestions', () => {
  it('作成と修正の問題だけを取り出し、作成は tempKey、修正は id を ref にする', () => {
    const result = extractQuestions(
      base({
        create: [
          {
            tempKey: 'q1',
            kind: 'keyword',
            stem: '問1',
            explanation: '解1',
            keywords: [],
            choices: [choice('A', true), choice('B')],
          },
        ],
        update: [
          {
            id: 'id-9',
            kind: 'feature',
            stem: '問2',
            explanation: '解2',
            keywords: [],
            choices: [{ id: 'c', ...choice('C', true) }],
          },
        ],
        disable: [{ id: 'id-x', reason: '理由' }],
      }),
    );
    expect(result).toEqual({
      ok: true,
      questions: [
        { ref: 'q1', kind: 'keyword', stem: '問1', explanation: '解1', choices: [choice('A', true), choice('B')] },
        { ref: 'id-9', kind: 'feature', stem: '問2', explanation: '解2', choices: [choice('C', true)] },
      ],
    });
  });

  it('tempKey がない作成は配列の位置から create#<n> を ref にする', () => {
    const q = { kind: 'keyword', stem: 's', explanation: 'e', choices: [choice('A', true)] };
    const result = extractQuestions(base({ create: [{ tempKey: 'k', ...q }, q] }));
    expect(result.ok && result.questions.map((x) => x.ref)).toEqual(['k', 'create#1']);
  });

  it('questions がなければ空の一覧を返す', () => {
    expect(extractQuestions({ format: 'ai-question-study/import', version: 1 })).toEqual({ ok: true, questions: [] });
  });

  it('対応外の format・version・形は ok: false', () => {
    expect(extractQuestions({ ...base({}), format: 'ai-question-study/export' }).ok).toBe(false);
    expect(extractQuestions({ ...base({}), version: 2 }).ok).toBe(false);
    expect(extractQuestions(null).ok).toBe(false);
    expect(extractQuestions(base({ create: 'x' })).ok).toBe(false);
    expect(extractQuestions(base({ create: [{ kind: 'other', stem: 's', explanation: 'e', choices: [] }] })).ok).toBe(
      false,
    );
    expect(extractQuestions(base({ update: [{ kind: 'keyword', stem: 's', explanation: 'e', choices: [] }] })).ok).toBe(
      false,
    );
    expect(
      extractQuestions(base({ create: [{ kind: 'keyword', stem: 's', explanation: 'e', choices: [{ body: 1 }] }] })).ok,
    ).toBe(false);
  });

  it('skill の取込用 JSON の例から作成と修正の問題を取り出す', () => {
    const path = resolve(process.cwd(), '.claude/skills/question-authoring/references/example-import.json');
    const result = extractQuestions(JSON.parse(readFileSync(path, 'utf8')));
    if (!result.ok) throw new Error(result.error);
    expect(result.questions.map((q) => [q.ref, q.kind, q.choices.length])).toEqual([
      ['q-k8s', 'keyword', 6],
      ['33333333-3333-4333-8333-333333333301', 'feature', 4],
    ]);
    expect(result.questions[0]?.choices[0]).toEqual({
      body: 'Kubernetes',
      explanation: 'コンテナオーケストレーションの代表的なツールである。',
      isCorrect: true,
    });
  });
});
