---
name: question-authoring
description: Read an export JSON written by the app's import/export screen and write an import JSON that creates, fixes, or disables questions according to the authoring principles. Use when the owner passes an export JSON path and a request for new or revised questions.
allowed-tools: Read, Write, Glob
argument-hint: <export-json-path> <request>
---

# question-authoring

Turn an export JSON into an import JSON that the owner imports through the app. This skill only reads and writes local files. It has no database, network, or shell access, never touches credentials, and never imports anything itself: the owner validates, previews, and applies the file in the app.

## Inputs

- `<export-json-path>`: path to an export JSON (`format` `ai-question-study/export`). Use Glob to locate it if the owner gives only a name or folder
- `<request>`: what the owner wants, for example "fix the flagged questions" or "add questions about keyword X". If empty, work on the questions with open flags

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

## Step 8: Report

Report, in Japanese:

- The written file path
- Counts of updated, created, and disabled questions, and of keyword additions, renames, and moves
- Every place where you departed from the principles (fewer choices, more than one piece of information, a comment you did not follow) and why
- Anything you could not do because the import cannot express it (see `references/exchange-format.md`)
- How to import: open 「入出力」 in the app, choose the file in the import panel, review the validation and the diff preview, then apply
