import { normalizeComment, type CheckboxFlagId } from '@/features/quiz/flags';

/** comment は normalizeComment 済みの値。 */
export type FlagSnapshot = { flags: CheckboxFlagId[]; comment: string | null };
export type FlagSaveStatus = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'failed'; message: string };
export type FlagSaver = {
  setFlags(flags: CheckboxFlagId[]): void;
  /** normalizeComment 後、確定済みの値と同じなら何もしない。 */
  commitComment(text: string): void;
  retry(): void;
  /** 実行中と未送信の要求が終わるまで待つ。成功なら true。 */
  flush(): Promise<boolean>;
  getStatus(): FlagSaveStatus;
  subscribe(listener: () => void): () => void;
};

function sameSnapshot(a: FlagSnapshot, b: FlagSnapshot): boolean {
  if (a.comment !== b.comment || a.flags.length !== b.flags.length) return false;
  const set = new Set(a.flags);
  return b.flags.every((f) => set.has(f));
}

/**
 * フラグの自動保存キュー。同時に実行する保存は1件だけで、実行中の変更は最新の希望値に集約し、
 * 完了時に送った値と違えば最新値を1回送る。失敗時は自動再送しない。
 */
export function createFlagSaver(initial: FlagSnapshot, save: (s: FlagSnapshot) => Promise<void>): FlagSaver {
  let desired: FlagSnapshot = { flags: [...initial.flags], comment: initial.comment };
  let saved: FlagSnapshot = desired;
  let inFlight = false;
  let status: FlagSaveStatus = { kind: 'idle' };
  const listeners = new Set<() => void>();
  let waiters: ((ok: boolean) => void)[] = [];

  const setStatus = (next: FlagSaveStatus) => {
    status = next;
    listeners.forEach((l) => l());
  };

  const settleWaiters = (ok: boolean) => {
    const current = waiters;
    waiters = [];
    current.forEach((w) => w(ok));
  };

  const run = () => {
    if (inFlight) return;
    inFlight = true;
    const sending = desired;
    if (status.kind !== 'saving') setStatus({ kind: 'saving' });
    // save が同期的に例外を投げても実行中のまま止まらないよう、拒否された Promise に変える
    let pending: Promise<void>;
    try {
      pending = save(sending);
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      () => {
        inFlight = false;
        saved = sending;
        if (!sameSnapshot(desired, sending)) {
          run();
          return;
        }
        setStatus({ kind: 'saved' });
        settleWaiters(true);
      },
      (error: unknown) => {
        inFlight = false;
        setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
        settleWaiters(false);
      },
    );
  };

  const request = (next: FlagSnapshot) => {
    if (sameSnapshot(next, desired) && status.kind !== 'failed') return;
    if (sameSnapshot(next, desired) && sameSnapshot(next, saved)) return;
    desired = next;
    run();
  };

  return {
    setFlags(flags) {
      request({ flags: [...flags], comment: desired.comment });
    },
    commitComment(text) {
      const comment = normalizeComment(text);
      if (comment === desired.comment) return;
      request({ flags: desired.flags, comment });
    },
    retry() {
      if (status.kind === 'failed') run();
    },
    flush() {
      if (!inFlight) return Promise.resolve(status.kind !== 'failed');
      return new Promise<boolean>((resolve) => waiters.push(resolve));
    },
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
