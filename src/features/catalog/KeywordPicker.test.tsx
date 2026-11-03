// キーワード選択: 葉・途中を複数選べ、選択済みを階層パスで表示する（4.3、8.5）
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { KeywordPicker } from './KeywordPicker';
import type { Keyword } from './types';

const KEYWORDS: Keyword[] = [
  { id: 'k1', subjectId: 's1', parentId: null, name: 'ネットワーク', sortOrder: 0 },
  { id: 'k2', subjectId: 's1', parentId: 'k1', name: 'TCP', sortOrder: 0 },
  { id: 'k3', subjectId: 's1', parentId: 'k1', name: 'UDP', sortOrder: 1 },
];

let latest: string[];
function Harness({ initial = [] as string[] }) {
  const [ids, setIds] = useState(initial);
  latest = ids;
  return <KeywordPicker keywords={KEYWORDS} selectedIds={ids} onChange={setIds} />;
}

describe('KeywordPicker', () => {
  it('途中ノードと葉を複数選べ、選択済みを階層パスで表示する', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'ネットワーク' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'TCP' }));
    expect(latest).toEqual(['k1', 'k2']);
    const list = screen.getByRole('list', { name: '選択済みのキーワード' });
    expect(within(list).getByText('ネットワーク / TCP')).toBeInTheDocument();
    expect(within(list).getByText('ネットワーク')).toBeInTheDocument();
  });

  it('選択を外せる', async () => {
    render(<Harness initial={['k3']} />);
    expect(screen.getByRole('checkbox', { name: 'UDP' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'UDP' }));
    expect(latest).toEqual([]);
    expect(screen.getByText('キーワードが選ばれていません')).toBeInTheDocument();
  });
});
