---
name: question-authoring
description: Read an export JSON written by the app's import/export screen and write an import JSON that creates, fixes, or disables questions according to the authoring principles, either from a request (modify mode) or from a range of a source text (source mode), then lint and blind-judge the written questions. Use when the owner passes an export JSON path and a request, or an export JSON path with source=<text-path> range=<range>.
allowed-tools: Read, Write, Glob, Bash(node scripts/authoring/lint-import.ts:*), Bash(node scripts/authoring/judge-import.ts:*)
argument-hint: <export-json-path> <request> | <export-json-path> source=<text-path> range=<range>
---

# question-authoring

Turn an export JSON into an import JSON that the owner imports through the app. This skill reads and writes local files and runs exactly two local scripts: `scripts/authoring/lint-import.ts` (mechanical guessability lint) and `scripts/authoring/judge-import.ts` (blind judging). It has no other shell access and no database or network access of its own, never touches credentials, and never imports anything itself: the owner validates, previews, and applies the file in the app.

## Inputs

The skill has two modes.

- Modify mode: `<export-json-path> <request>`
  - `<export-json-path>`: path to an export JSON (`format` `ai-question-study/export`). Use Glob to locate it if the owner gives only a name or folder
  - `<request>`: what the owner wants, for example "fix the flagged questions" or "add questions about keyword X". If empty, work on the questions with open flags
- Source mode: `<export-json-path> source=<text-path> range=<range>`
  - `source=<text-path>`: a source text (syllabus or similar) under `exchange-data/`, which is git-ignored. Never copy its text into any output (see Source mode)
  - `range=<range>`: the part of the source to cover, at most one 中分類 (middle category). If the range covers more than one 中分類, do not write any file; stop and ask the owner to split the range into one 中分類 per run

Steps 1, 2, and 5 to 10 apply to both modes. Steps 3 and 4 apply to modify mode; source mode replaces them with the Source mode section.

## Step 1: Read the rules

1. Read `references/exchange-format.md` (in this skill's directory). It is the authoritative definition of both formats, keyword references, choice IDs, temporary keys, and operations the import cannot express. `references/example-import.json` shows a valid import file
2. Read `.kiro/steering/product.md`, sections 「問題作成の原則」 (authoring principles) and 「問題フラグ」 (question flags). These are the authoritative rules; follow them even where this skill summarizes them

## Step 2: Read and check the export JSON

1. Read the export JSON
2. Continue only if `format` is `ai-question-study/export` and `version` is `1`. Otherwise do not write any file; report the actual `format` and `version` and that they are unsupported
3. If the JSON cannot be parsed or required root fields are missing, stop the same way and report what is wrong

## Step 3: Choose targets

- Follow the owner's request first
- Use open flags (`openFlags`) as hints for what to fix (see Step 4)
- Use aggregates (`stats`) only to set priority, never as content:
  - A very high correct rate with many attempts suggests the question may be guessable
  - A very low correct rate suggests the question may be defective or need a better explanation
  - Few attempts mean the rate is not reliable
- Disabled questions (`status: disabled`) have no stats: their counts are 0 and their rates are null. Do not read that as "never answered" or "hard". Updating a disabled question is allowed but produces a warning, and the import cannot re-enable it
- Treat keywords without questions, or with few questions, as candidates for new questions when the request asks for new content

## Step 4: Handle each flag type

| Flag | Policy |
| --- | --- |
| `guessable` | Make the wrong choices equally plausible. Remove clues that make only the correct choice stand out (length, wording, specificity, overlap with the stem) |
| `low_value` | Rewrite the question to ask about something important for the learning target, or propose disabling it (with a reason) |
| `needs_explanation` | Add to the explanation of the question and of each choice |
| `defective` | Correct a wrong answer or wrong stem so exactly one choice is correct |
| `comment` | Read the free-text comment and address what it points out. If it is unclear or you disagree, say so in the report |

A question may have several flags; address all of them. Flags of updated questions are resolved by the app automatically, so never try to write flags.

## Source mode

Use this section instead of Steps 3 and 4 when `source=` is given.

1. Read the target range of the source text and extract its hierarchy: 大分類 > 中分類 > 小分類 > 項目 > 細目 > 用語 (terms). Build the keyword tree from the hierarchy down to the terms
2. Match the tree against the export's existing keywords by name and position. Reuse an existing keyword by its `id`; add a new one to `keywords.add` with a `tempKey`
   - The same term under different items becomes separate keywords, one under each item
   - When the source lists an abbreviation with its full name, name the keyword with the abbreviation only, and write the full name in the explanations
3. Decide whether each entry is a term
   - For a term, write at least one question about it. The question does not have to make the term itself the correct answer: a `feature` question about the term, or a question whose correct answer is another word that can only be chosen with knowledge of the term, is also fine. For an important term, add more questions
   - When a term's name literally spells out its meaning (for example 和集合, 温度センサー, スタートビット), a question that names the term from its definition is guessable. Prefer a `feature` question or a question with another correct answer for such terms, or use wrong choices with the same literal structure
   - Non-term entries, such as category catch-alls (「その他のソート」) or situation descriptions (「サーバーへの利用集中」), are never a correct answer. If their content is worth learning, write a question that asks about that content; otherwise make no question and list the entry in the report
4. Link each question to the deepest keyword it is about: the term keyword, or the item keyword when the item has no terms
   - Never copy sentences from the source text into stems, choices, explanations, or any other output. Write in your own words
   - For terms that need a calculation, do not ask for a concrete value. Ask about the calculation method instead (the form of the formula, the procedure, or the meaning of the values used), usually as a `feature` question. Only when even the method cannot be asked as a multiple-choice question, make no question and record the term and the reason for the report

Then continue with Step 5.

## Step 5: Write the content

- Write all generated content (stems, choices, explanations, keyword names, disable reasons) in Japanese
- If an existing question's text is too vague to tell what it asks, rebuild it from its keyword paths and state that you did so in the report
- Follow the authoring principles from `product.md`:
  - One question asks about one piece of information. Split compound questions into separate ones
  - `keyword` questions have 6 choices: 2 to 4 real terms, the rest non-existent terms or terms outside the learning target
  - `feature` questions have 4 choices
  - Reduce the number of choices only when plausible wrong answers cannot be made, and note the reason for the report
  - Exactly one choice is correct
  - Never write the full name of an abbreviation in the stem or choices; always write it in an explanation
  - The question and every choice have an explanation
  - Never add a 「わからない」 (don't know) choice. It is a fixed UI choice and is not stored as data
- References (see `references/exchange-format.md`):
  - Refer to existing keywords and questions by `id`; refer to keywords new in this file by `tempKey` (for example `kw-...`). Give new questions a `tempKey` such as `q-...`
  - In `update`, list the complete set of choices after the update. A choice whose meaning stays the same keeps its `id`. A choice whose meaning changes is written without an `id`, as a new choice. Never reuse an existing choice `id` for a choice with a different meaning
  - Do not write aggregates (`stats`), `openFlags`, or `status` into the import JSON
  - Never delete anything. Deleting keywords or questions is not expressible; use `disable` with a reason instead when a question should stop being asked
- Keep a file to a few hundred questions at most. For larger work, split it into several import files

## Step 6: Self-check before writing

Check every created or updated question:

- Exactly one choice has `isCorrect: true`
- The number of choices matches the kind (6 for `keyword`, 4 for `feature`), or the reduction has a recorded reason
- No duplicate choices (same or equivalent text) within a question
- Every abbreviation has its full name in an explanation, and no full name appears in the stem or choices
- The question and every choice have a non-empty explanation
- The question asks about one piece of information only
- Every question links at least one keyword, and every reference resolves (existing `id` in the export, or a `tempKey` defined in `keywords.add`)
- Each keyword or question is the target of at most one operation, sibling keywords do not share a name, and no move creates a cycle

Fix any failure before writing.

## Step 7: Write the import JSON

- Write it in the same directory as the export JSON, named `<export file name without .json>.import.json` (for example `exchange-data/math.json` becomes `exchange-data/math.import.json`). Generated files belong in `exchange-data/`, which is not tracked as source
- Set `format` to `ai-question-study/import`, `version` to `1`, `subjectId` to the export's `subject.id`, and `basedOnExportedAt` to the export's `exportedAt`
- If the target file already exists, ask before overwriting it. If you cannot ask (non-interactive run), write `<name>.import-2.json` (or the next free number) instead and say so in the report

## Step 8: Lint the import JSON

Run this in both modes, after writing the import JSON.

1. Run `node scripts/authoring/lint-import.ts <import.json>`. It writes the warnings per question to `<import>.lint.json` and prints a summary. Exit code 0 means it ran (warnings may still exist); exit code 1 means the file could not be read or is unsupported, so fix the file first
2. For each warning, rewrite the question, or record why you keep it as is (for the report)

## Step 9: Blind-judge the import JSON

Run this in both modes, after the lint.

1. Run `node scripts/authoring/judge-import.ts <import.json>`. It writes per-question results to `<import>.judge.json` and prints the judged count, guessable count, cue breakdown, and the counts of `error` and `unparsed`. Exit code 2 means at least one `error` or `unparsed` result remains
2. For each question judged guessable, replace the wrong choices, in this order of preference:
   - Real terms that are easy to confuse with the correct answer and that also fit the stem by their everyday meaning
   - If those cannot be found, non-existent terms built from the same word parts as the correct answer. State in that choice's explanation that the term does not exist, briefly, quoting the choice text, for example 「「LSMT」は実在しない語である。」. Quoting it also keeps the app's abbreviation warning away, since the app only checks that each abbreviation appears somewhere in an explanation. Keep it to that one sentence
   - If replacing wrong choices cannot remove the cue (for example, the term's name literally spells out the stem), change how the question asks instead: ask about a feature of the term, or make another word the correct answer
3. After rewriting, update the import JSON, re-run Step 8, then re-judge only the rewritten questions with `node scripts/authoring/judge-import.ts <import.json> --only <refs>` (comma-separated refs from the judge output). This merges the new results into the existing `<import>.judge.json`
4. Allow at most 5 rewrites per question. After the fifth, stop rewriting that question and list it as unresolved in the report
5. For an `unparsed` result, read its raw response (`raw`). If a chosen number can be read, map it back to the original position through `order` and compare it with `correctIndex`; treat the question as judged. If it cannot be read, re-run that question with `--only`
6. If `error` results or unreadable responses remain, do not treat the import JSON as judged, and list the unjudged questions in the report

## Step 10: Report

Report, in Japanese:

- The written file path, and the lint and judge result files
- Counts of updated, created, and disabled questions, and of keyword additions, renames, and moves
- In source mode: term count, keyword count, question count, terms not made and the reasons (for example a calculation whose method cannot be asked either), calculation-method questions made, and non-term entries with how each was handled (asked about its content, or skipped)
- Lint warnings and the response to each (rewritten, or kept with a reason)
- Judging: judged count, guessable count with the breakdown by cue, rewrite-count distribution, unresolved questions (still guessable after 5 rewrites), and unjudged questions (errors or unreadable responses)
- Every place where you departed from the principles (fewer choices, more than one piece of information, a comment you did not follow) and why
- Anything you could not do because the import cannot express it (see `references/exchange-format.md`)
- How to import: open 「入出力」 in the app, choose the file in the import panel, review the validation and the diff preview, then apply
