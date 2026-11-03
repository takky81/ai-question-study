// カタログのドメイン型。「わからない」は型にも DB にも存在しない（4.9）。
import type { KeywordNode } from '@/lib/keywordTree';

export type QuestionKind = 'keyword' | 'feature';
export type QuestionStatus = 'active' | 'disabled';

export type Subject = { id: string; name: string; createdAt: string };
export type Keyword = KeywordNode & { subjectId: string };

export type ChoiceInput = { id: string | null; body: string; explanation: string; isCorrect: boolean };
export type QuestionInput = {
  id: string | null;
  subjectId: string;
  kind: QuestionKind;
  stem: string;
  explanation: string;
  keywordIds: string[];
  choices: ChoiceInput[]; // 配列順が表示順
};

export type Question = Omit<QuestionInput, 'id' | 'choices'> & {
  id: string;
  choices: (ChoiceInput & { id: string })[];
  status: QuestionStatus;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuestionListItem = {
  id: string;
  kind: QuestionKind;
  stem: string;
  status: QuestionStatus;
  keywordIds: string[];
  createdAt: string;
};
