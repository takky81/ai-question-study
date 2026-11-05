import { describe, expect, it, vi } from 'vitest';
import { createFlagSaver, type FlagSnapshot } from '@/features/quiz/flagAutosave';

type Call = { snapshot: FlagSnapshot; resolve: () => void; reject: (e: unknown) => void };

function fakeSave() {
  const calls: Call[] = [];
  const save = vi.fn(
    (snapshot: FlagSnapshot) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ snapshot, resolve, reject });
      }),
  );
  return { calls, save };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createFlagSaver', () => {
  it('実行中の変更を集約し、完了後に最後の値だけを1回送る', async () => {
    const { calls, save } = fakeSave();
    const saver = createFlagSaver({ flags: [], comment: null }, save);
    saver.setFlags(['low_value']);
    expect(saver.getStatus()).toEqual({ kind: 'saving' });
    saver.setFlags(['low_value', 'defective']);
    saver.setFlags(['defective']);
    expect(calls).toHaveLength(1);
    calls[0]!.resolve();
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.snapshot).toEqual({ flags: ['defective'], comment: null });
    calls[1]!.resolve();
    await tick();
    expect(calls).toHaveLength(2);
    expect(saver.getStatus()).toEqual({ kind: 'saved' });
  });

  it('送信は直列で、古い値が後から送られない', async () => {
    const { calls, save } = fakeSave();
    const saver = createFlagSaver({ flags: [], comment: null }, save);
    saver.setFlags(['low_value']);
    saver.setFlags([]);
    calls[0]!.resolve();
    await tick();
    expect(calls.map((c) => c.snapshot.flags)).toEqual([['low_value'], []]);
    calls[1]!.resolve();
    await tick();
    expect(calls).toHaveLength(2);
  });

  it('保存済みと同じコメント（前後の空白の差だけ）の blur は送らない', async () => {
    const { calls, save } = fakeSave();
    const saver = createFlagSaver({ flags: [], comment: 'メモ' }, save);
    saver.commitComment('  メモ \n');
    expect(calls).toHaveLength(0);
    expect(saver.getStatus()).toEqual({ kind: 'idle' });
  });

  it('空白の blur で comment = null を送る', async () => {
    const { calls, save } = fakeSave();
    const saver = createFlagSaver({ flags: ['low_value'], comment: 'メモ' }, save);
    saver.commitComment('   ');
    expect(calls[0]!.snapshot).toEqual({ flags: ['low_value'], comment: null });
  });

  it('チェックの保存は blur で確定済みのコメントを送る', async () => {
    const { calls, save } = fakeSave();
    const saver = createFlagSaver({ flags: [], comment: '前' }, save);
    saver.commitComment(' 後 ');
    calls[0]!.resolve();
    await tick();
    saver.setFlags(['defective']);
    expect(calls[1]!.snapshot).toEqual({ flags: ['defective'], comment: '後' });
  });

  it('失敗で failed になり自動再送しない', async () => {
    const { calls, save } = fakeSave();
    const saver = createFlagSaver({ flags: [], comment: null }, save);
    const listener = vi.fn();
    saver.subscribe(listener);
    saver.setFlags(['low_value']);
    calls[0]!.reject(new Error('フラグの保存に失敗しました: x'));
    await tick();
    expect(saver.getStatus()).toEqual({ kind: 'failed', message: 'フラグの保存に失敗しました: x' });
    expect(calls).toHaveLength(1);
    expect(listener).toHaveBeenCalled();
  });

  it('retry は最新の値を送る', async () => {
    const { calls, save } = fakeSave();
    const saver = createFlagSaver({ flags: [], comment: null }, save);
    saver.setFlags(['low_value']);
    saver.setFlags(['defective']);
    calls[0]!.reject(new Error('e'));
    await tick();
    expect(calls).toHaveLength(1);
    saver.retry();
    expect(calls[1]!.snapshot).toEqual({ flags: ['defective'], comment: null });
    calls[1]!.resolve();
    await tick();
    expect(saver.getStatus()).toEqual({ kind: 'saved' });
  });

  it('失敗中の新しい変更で最新値を送る', async () => {
    const { calls, save } = fakeSave();
    const saver = createFlagSaver({ flags: [], comment: null }, save);
    saver.setFlags(['low_value']);
    calls[0]!.reject(new Error('e'));
    await tick();
    saver.commitComment('追記');
    expect(calls[1]!.snapshot).toEqual({ flags: ['low_value'], comment: '追記' });
  });

  it('flush は実行中・未送信の完了を待って成功なら true を返す', async () => {
    const { calls, save } = fakeSave();
    const saver = createFlagSaver({ flags: [], comment: null }, save);
    saver.setFlags(['low_value']);
    saver.commitComment('c');
    let result: boolean | undefined;
    void saver.flush().then((r) => (result = r));
    calls[0]!.resolve();
    await tick();
    expect(result).toBeUndefined();
    calls[1]!.resolve();
    await tick();
    expect(result).toBe(true);
  });

  it('flush は失敗なら false を返し、変更がなければすぐ true を返す', async () => {
    const { calls, save } = fakeSave();
    const saver = createFlagSaver({ flags: [], comment: null }, save);
    await expect(saver.flush()).resolves.toBe(true);
    saver.setFlags(['low_value']);
    const p = saver.flush();
    calls[0]!.reject(new Error('e'));
    await expect(p).resolves.toBe(false);
    await expect(saver.flush()).resolves.toBe(false);
  });
});
