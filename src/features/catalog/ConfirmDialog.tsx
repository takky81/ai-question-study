import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 危険操作（削除・破棄）なら確定ボタンを警告色にする */
  danger?: boolean;
  /** 処理中は確定ボタンを無効にして二重実行を防ぐ */
  busy?: boolean;
  /** 確定に失敗したときのエラー。モーダルの背後では見えないためダイアログ内に表示する */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 削除・破棄の確認ダイアログ（catalog 内のみで使用）。
 * `<dialog>` のモーダル表示でフォーカスを閉じ込め、開いたときは確定以外のボタンへフォーカスし、
 * Esc で閉じ、閉じたら開く前の要素へフォーカスを戻す（9.4）。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'キャンセル',
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: Props): ReactElement | null {
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

  const confirmClass = danger
    ? 'bg-warn text-bg border-warn'
    : 'bg-primary text-bg border-primary';

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
        {title}
      </h2>
      <div id={messageId} className="mt-2 break-words">
        {message}
      </div>
      {error && (
        <p role="alert" className="mt-2 break-words text-warn">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          className="tap-target focus-ring rounded border border-border px-4"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`tap-target focus-ring rounded border px-4 font-bold disabled:opacity-50 ${confirmClass}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
