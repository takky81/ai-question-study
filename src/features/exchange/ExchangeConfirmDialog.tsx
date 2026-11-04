import { useEffect, useId, useRef, type ReactElement } from 'react';

type Props = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 取込ファイル・プレビューの破棄と離脱の確認（exchange 内のみで使用）。
 * `<dialog>` のモーダル表示でフォーカスを閉じ込め、開いたときは確定以外のボタンへフォーカスし、
 * Esc で閉じ、閉じたら開く前の要素へフォーカスを戻す（10.4、10.6）。
 */
export function ExchangeConfirmDialog({ open, onConfirm, onCancel }: Props): ReactElement | null {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    cancelRef.current?.focus();
    return () => {
      if (dialog?.open && typeof dialog.close === 'function') dialog.close();
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded border border-border bg-bg p-4 text-text backdrop:bg-black/40"
      onCancel={(e) => {
        // ブラウザ既定の close ではなく親の状態で閉じる
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <h2 id={titleId} className="text-lg font-bold break-words">
        取込の内容を破棄しますか
      </h2>
      <p id={messageId} className="mt-2 break-words">
        読み込んだ取込ファイルとプレビューを破棄して移動します。
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          className="tap-target focus-ring rounded border border-border px-4"
          onClick={onCancel}
        >
          キャンセル
        </button>
        <button
          type="button"
          className="tap-target focus-ring rounded border border-warn bg-warn px-4 font-bold text-bg"
          onClick={onConfirm}
        >
          破棄して移動
        </button>
      </div>
    </dialog>
  );
}
