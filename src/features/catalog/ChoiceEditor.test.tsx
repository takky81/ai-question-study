// 選択肢編集: 正解は1つだけ、正解の印と class、「わからない」がない、並べ替え・削除・追加（4.5、4.9、9.5）
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ChoiceEditor } from './ChoiceEditor';
import type { QuestionInput } from './types';

function draft(): QuestionInput {
  return {
    id: null,
    subjectId: 's1',
    kind: 'feature',
    stem: '',
    explanation: '',
    keywordIds: [],
    choices: ['A', 'B', 'C'].map((b) => ({ id: null, body: b, explanation: '', isCorrect: b === 'A' })),
  };
}

let latest: QuestionInput;
function Harness() {
  const [d, setD] = useState(draft);
  latest = d;
  return <ChoiceEditor draft={d} onChange={setD} />;
}

function items() {
  return screen.getAllByRole('listitem');
}

describe('ChoiceEditor', () => {
  it('正解のラジオは1つだけ選択される', async () => {
    render(<Harness />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    await userEvent.click(radios[1]!);
    expect(radios.filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1);
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
    expect(latest.choices.map((c) => c.isCorrect)).toEqual([false, true, false]);
  });

  it('正解の選択肢にだけ mark-correct と ○ の印を付け、警告色を使わない', async () => {
    const { container } = render(<Harness />);
    const marks = container.querySelectorAll('.mark-correct');
    expect(marks).toHaveLength(1);
    expect(within(items()[0]!).getByText('○')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/warn/);
    await userEvent.click(screen.getAllByRole('radio')[2]!);
    expect(within(items()[2]!).getByText('○')).toBeInTheDocument();
    expect(within(items()[0]!).queryByText('○')).toBeNull();
  });

  it('「わからない」の選択肢を持たない', () => {
    render(<Harness />);
    expect(screen.queryByText(/わからない/)).toBeNull();
    expect(items()).toHaveLength(3);
  });

  it('本文と解説を編集でき、上へ／下へ／削除／追加ができる', async () => {
    render(<Harness />);
    const body = within(items()[1]!).getByLabelText('選択肢 2 の本文');
    await userEvent.clear(body);
    await userEvent.type(body, 'X');
    await userEvent.type(within(items()[1]!).getByLabelText('選択肢 2 の解説'), 'e');
    expect(latest.choices[1]).toMatchObject({ body: 'X', explanation: 'e' });

    expect(within(items()[0]!).getByRole('button', { name: '選択肢 1 を上へ' })).toBeDisabled();
    expect(within(items()[2]!).getByRole('button', { name: '選択肢 3 を下へ' })).toBeDisabled();
    await userEvent.click(within(items()[1]!).getByRole('button', { name: '選択肢 2 を上へ' }));
    expect(latest.choices.map((c) => c.body)).toEqual(['X', 'A', 'C']);
    await userEvent.click(within(items()[0]!).getByRole('button', { name: '選択肢 1 を下へ' }));
    expect(latest.choices.map((c) => c.body)).toEqual(['A', 'X', 'C']);
    await userEvent.click(within(items()[2]!).getByRole('button', { name: '選択肢 3 を削除' }));
    expect(latest.choices.map((c) => c.body)).toEqual(['A', 'X']);
    await userEvent.click(screen.getByRole('button', { name: '選択肢を追加' }));
    expect(latest.choices).toHaveLength(3);
  });
});
