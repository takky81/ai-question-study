-- 解説の任意化: 問題と選択肢の解説の空文字を許す（not null は残す）
alter table public.questions drop constraint questions_explanation_check;
alter table public.choices drop constraint choices_explanation_check;
