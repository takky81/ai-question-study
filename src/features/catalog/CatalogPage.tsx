import { useCallback, useId, useMemo, useState, type ReactElement } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { parseFilter, toSearchParams } from './filters';
import { KeywordTree } from './KeywordTree';
import { QuestionList } from './QuestionList';
import { SubjectList } from './SubjectList';

type Tab = 'tree' | 'list';

/**
 * カタログ画面。`catalog` で科目一覧、`catalog/:subjectId` で木と問題一覧を表示する。
 * PC 幅（lg 以上）は2列、モバイル幅はタブで切り替える（9.2、9.3）。
 * 木で選んだキーワードを一覧の絞り込み（URL の keyword）に設定する（7.2）。
 */
export function CatalogPage(): ReactElement {
  const { subjectId } = useParams();
  if (!subjectId) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-xl font-bold">カタログ</h1>
        <SubjectList />
      </div>
    );
  }
  // 科目が変わったら選択タブなどの状態を初期化する
  return <SubjectCatalog key={subjectId} subjectId={subjectId} />;
}

function SubjectCatalog({ subjectId }: { subjectId: string }): ReactElement {
  const baseId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => parseFilter(searchParams), [searchParams]);
  const [tab, setTab] = useState<Tab>('tree');
  // 木の編集後に一覧を作り直し、キーワードの階層パスを再取得させる
  const [listVersion, setListVersion] = useState(0);

  const onSelect = useCallback(
    (id: string | null) => {
      const current = parseFilter(searchParams);
      if (current.keywordId === id) return;
      setSearchParams(toSearchParams({ ...current, keywordId: id, page: 1 }));
    },
    [searchParams, setSearchParams],
  );
  const onChanged = useCallback(() => setListVersion((v) => v + 1), []);

  const tabId = (t: Tab) => `${baseId}-tab-${t}`;
  const panelId = (t: Tab) => `${baseId}-panel-${t}`;
  const tabs: { key: Tab; label: string }[] = [
    { key: 'tree', label: 'キーワード' },
    { key: 'list', label: '問題' },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Link to="/catalog" className="tap-target focus-ring flex w-fit items-center text-primary underline">
        科目一覧へ戻る
      </Link>
      <div role="tablist" aria-label="表示の切り替え" className="flex gap-2 lg:hidden">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={tabId(t.key)}
            aria-controls={panelId(t.key)}
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const next: Tab = t.key === 'tree' ? 'list' : 'tree';
                setTab(next);
                document.getElementById(tabId(next))?.focus();
              }
            }}
            className={`tap-target focus-ring flex-1 rounded border px-3 ${
              tab === t.key ? 'border-primary bg-primary font-bold text-bg' : 'border-border'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div
          role="tabpanel"
          id={panelId('tree')}
          aria-labelledby={tabId('tree')}
          className={`min-w-0 break-words ${tab === 'tree' ? 'block' : 'hidden'} lg:block`}
        >
          <KeywordTree subjectId={subjectId} selectedId={filter.keywordId} onSelect={onSelect} onChanged={onChanged} />
        </div>
        <div
          role="tabpanel"
          id={panelId('list')}
          aria-labelledby={tabId('list')}
          className={`min-w-0 break-words ${tab === 'list' ? 'block' : 'hidden'} lg:block`}
        >
          <QuestionList key={listVersion} subjectId={subjectId} />
        </div>
      </div>
    </div>
  );
}
