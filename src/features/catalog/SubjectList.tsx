import { useCallback, useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from './ConfirmDialog';
import {
  countSubjectContents,
  createSubject,
  deleteSubject,
  listSubjects,
  renameSubject,
} from './api';
import type { Subject } from './types';

const EMPTY_NAME = '科目名を入力してください';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type Deleting = {
  subject: Subject;
  counts: { keywordCount: number; questionCount: number };
};

/** 科目の一覧・作成・改名・削除（2.1〜2.5）。各科目はキーワード木と問題一覧の画面へ移動する。 */
export function SubjectList(): ReactElement {
  const newNameId = useId();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);

  const reload = useCallback(async () => {
    try {
      setSubjects(await listSubjects());
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 処理中の二重実行を防ぎ、失敗は日本語のエラーとして表示する
  async function run(action: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setError(EMPTY_NAME);
      return;
    }
    const ok = await run(async () => {
      await createSubject(name);
      await reload();
    });
    if (ok) setNewName('');
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      setError(EMPTY_NAME);
      return;
    }
    const ok = await run(async () => {
      await renameSubject(editing.id, name);
      await reload();
    });
    if (ok) setEditing(null);
  }

  async function onAskDelete(subject: Subject) {
    await run(async () => {
      const counts = await countSubjectContents(subject.id);
      setDeleting({ subject, counts });
    });
  }

  async function onConfirmDelete() {
    if (!deleting) return;
    const ok = await run(async () => {
      await deleteSubject(deleting.subject.id);
      await reload();
    });
    if (ok) setDeleting(null);
  }

  return (
    <section aria-labelledby={`${newNameId}-h`} className="flex min-w-0 flex-col gap-4">
      <h2 id={`${newNameId}-h`} className="text-lg font-bold">
        科目
      </h2>

      <form onSubmit={onCreate} className="flex min-w-0 flex-wrap items-end gap-2">
        <label htmlFor={newNameId} className="flex min-w-0 flex-1 flex-col gap-1">
          <span>新しい科目名</span>
          <input
            id={newNameId}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="tap-target focus-ring min-w-0 rounded border border-border bg-bg px-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="tap-target focus-ring rounded border border-primary bg-primary px-4 font-bold text-bg disabled:opacity-50"
        >
          科目を作成
        </button>
      </form>

      {error && !deleting && (
        <p role="alert" className="break-words text-warn">
          {error}
        </p>
      )}
      {loadError && (
        <p role="alert" className="break-words text-warn">
          {loadError}
        </p>
      )}

      {subjects.length === 0 && !loadError ? (
        <p className="text-text-muted">科目はまだありません</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {subjects.map((s) => (
            <li
              key={s.id}
              className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-border bg-surface p-2"
            >
              {editing?.id === s.id ? (
                <form onSubmit={onRename} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <input
                    aria-label={`${s.name} の新しい名前`}
                    value={editing.name}
                    onChange={(e) => setEditing({ id: s.id, name: e.target.value })}
                    className="tap-target focus-ring min-w-0 flex-1 rounded border border-border bg-bg px-2"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="tap-target focus-ring rounded border border-primary px-3 disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setError(null);
                    }}
                    className="tap-target focus-ring rounded border border-border px-3"
                  >
                    取り消す
                  </button>
                </form>
              ) : (
                <>
                  <Link
                    to={`/catalog/${s.id}`}
                    className="tap-target focus-ring flex min-w-0 flex-1 items-center break-words underline-offset-4 hover:underline"
                  >
                    {s.name}
                  </Link>
                  <button
                    type="button"
                    aria-label={`${s.name} の名前を変更`}
                    disabled={busy}
                    onClick={() => {
                      setEditing({ id: s.id, name: s.name });
                      setError(null);
                    }}
                    className="tap-target focus-ring rounded border border-border px-3 disabled:opacity-50"
                  >
                    名前を変更
                  </button>
                  <button
                    type="button"
                    aria-label={`${s.name} を削除`}
                    disabled={busy}
                    onClick={() => void onAskDelete(s)}
                    className="tap-target focus-ring rounded border border-warn px-3 text-warn disabled:opacity-50"
                  >
                    削除
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `科目「${deleting.subject.name}」を削除` : ''}
        message={
          deleting && (
            <>
              <p>
                配下のキーワード {deleting.counts.keywordCount} 件を削除し、問題{' '}
                {deleting.counts.questionCount} 件を削除状態にします。
              </p>
              <p className="mt-1">削除すると元に戻せません。</p>
            </>
          )
        }
        confirmLabel="削除する"
        danger
        busy={busy}
        error={deleting ? error : null}
        onConfirm={() => void onConfirmDelete()}
        onCancel={() => {
          setDeleting(null);
          setError(null);
        }}
      />
    </section>
  );
}
