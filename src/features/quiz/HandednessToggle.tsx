// 配置の切り替え: 右手用／左手用の2つのボタン。選択中は aria-pressed と選択表示で示す（11.1、11.8）
import { HANDEDNESS_LABELS, type Handedness } from './handedness';

type Props = {
  value: Handedness;
  onChange: (next: Handedness) => void;
};

const BUTTON = 'tap-target focus-ring rounded border border-border px-3 text-text';
const OPTIONS: readonly Handedness[] = ['right', 'left'];

export function HandednessToggle({ value, onChange }: Props) {
  return (
    <div role="group" aria-label="操作の配置" className="flex gap-1">
      {OPTIONS.map((option) => {
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={`${BUTTON} ${selected ? 'choice-selected font-bold' : ''}`}
          >
            {HANDEDNESS_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
