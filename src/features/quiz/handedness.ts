// 解答画面の操作の配置（右手用／左手用）。セッション中だけ保持し、永続化しない（Requirement 11）
export type Handedness = 'right' | 'left';

export const DEFAULT_HANDEDNESS: Handedness = 'right';

export const HANDEDNESS_LABELS: Record<Handedness, string> = { right: '右手用', left: '左手用' };
