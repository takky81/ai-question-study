// 検証のエラー・警告の表示（4.2、4.3、4.10）
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IssueList, formatIssuePath } from './IssueList';

describe('formatIssuePath', () => {
  it('位置を人が読める表記にする', () => {
    expect(formatIssuePath('questions.update[3].choices[1].body')).toBe('問題の修正 4件目 / 選択肢 2 / 本文');
    expect(formatIssuePath('keywords.add[0].name')).toBe('キーワードの追加 1件目 / 名前');
    expect(formatIssuePath('questions.create[0].stem')).toBe('問題の新規作成 1件目 / 問題文');
    expect(formatIssuePath('')).toBe('ファイル全体');
    expect(formatIssuePath('version')).toBe('バージョン');
  });
});

describe('IssueList', () => {
  it('エラーと警告を分けて件数と一覧を出し、色以外の印と文字で区別する', () => {
    render(
      <IssueList
        issues={[
          { severity: 'error', path: 'questions.update[3].choices[1].body', code: 'required', message: '本文がありません' },
          { severity: 'warning', path: 'questions.create[0].stem', code: 'updated_since_export', message: '出力後に更新されています' },
          { path: 'version', code: 'unsupported_version', message: '対応外のバージョンです' },
        ]}
      />,
    );
    const errors = screen.getByRole('region', { name: 'エラー 2件' });
    const warnings = screen.getByRole('region', { name: '警告 1件' });
    expect(within(errors).getAllByRole('listitem')).toHaveLength(2);
    expect(within(errors).getByText('問題の修正 4件目 / 選択肢 2 / 本文')).toBeInTheDocument();
    expect(within(errors).getByText('本文がありません')).toBeInTheDocument();
    expect(within(errors).getAllByText('エラー').length).toBe(2);
    expect(within(warnings).getByText('出力後に更新されています')).toBeInTheDocument();
    expect(within(warnings).getAllByText('警告').length).toBe(1);
  });

  it('問題がなければ何も出さない', () => {
    const { container } = render(<IssueList issues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
