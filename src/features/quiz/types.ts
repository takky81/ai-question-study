// 出題セッションのドメイン型。問題種別は catalog の型を使う。
import type { QuestionKind } from '@/features/catalog/types';

export type AnswerKind = 'normal' | 'guess' | 'unknown';

export type QuestionStats = {
  attemptCount: number;
  correctCount: number;
  correctRate: number | null; // 出題数 0 は null
  retention: number | null; // 0〜1、SRS 状態なしは null
  lastAnsweredAt: string | null;
};

export type QuizCandidate = QuestionStats & { questionId: string; createdAt: string };

export type QuizChoice = { id: string; body: string; explanation: string; isCorrect: boolean };

export type QuizQuestion = {
  id: string;
  subjectId: string;
  kind: QuestionKind;
  stem: string;
  explanation: string;
  keywordIds: string[];
  choices: QuizChoice[]; // position 順、removed_at の行は除く
  stats: QuestionStats;
};

export type AnswerResult = QuestionStats & {
  answerId: string;
  isCorrect: boolean;
  correctChoiceId: string;
  alreadyRecorded: boolean;
};
