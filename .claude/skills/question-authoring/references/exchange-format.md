# Exchange Format (version 1)

This document defines two JSON formats. The export JSON is written by the app's "入出力" (import/export) screen and read by the question-authoring skill. The import JSON is written by the skill and read by the app. Everything needed to read and write both formats is in this document.

| Kind | `format` value | `version` | Written by | Read by |
| --- | --- | --- | --- | --- |
| Export | `ai-question-study/export` | `1` | App | Question-authoring skill |
| Import | `ai-question-study/import` | `1` | Question-authoring skill | App |

Both files start with `"format"` and `"version": 1`. A file whose `format` differs, or whose `version` is anything other than `1`, is unsupported and must not be processed further. All timestamps are ISO 8601 strings. All IDs are strings (UUIDs).

## Export JSON

The app writes this file using the conditions the user selected. Treat it as read-only input, and do not copy it verbatim into the import JSON.

### Root

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format` | string | required | `ai-question-study/export` |
| `version` | number | required | `1` |
| `exportedAt` | string | required | Export timestamp. Copy it into `basedOnExportedAt` of the import JSON |
| `subject` | object | required | The subject: `id` (string) and `name` (string) |
| `conditions` | object | required | Filter conditions used for the export (see below) |
| `keywords` | array | required | The subject's entire keyword tree, regardless of filters, in depth-first tree order |
| `questions` | array | required | Questions that match the conditions |

### `conditions`

| Field | Type | Meaning |
| --- | --- | --- |
| `keywordId` | string or null | Scope keyword. Questions linked to its subtree are targeted. null means the whole subject |
| `flag` | `all`, `any`, `none`, `types` | Open-flag condition: `all` = no filter, `any` = has at least one, `none` = has none, `types` = has one of `flagTypes` |
| `flagTypes` | string array | Flag identifiers used when `flag` is `types` |
| `correctRateMin` | number or null | Lower bound of the correct rate (0–1) |
| `correctRateMax` | number or null | Upper bound of the correct rate (0–1) |
| `attemptMin` | number or null | Lower bound of the attempt count |
| `attemptMax` | number or null | Upper bound of the attempt count |
| `attempted` | boolean or null | `true` = attempted only, `false` = never attempted only, null = no filter |
| `includeDisabled` | boolean | Whether disabled questions were included |

### `keywords` elements

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Keyword ID |
| `parentId` | string or null | Parent keyword ID. null for a root |
| `name` | string | Name |
| `sortOrder` | number | Order among siblings |
| `path` | string array | Names from the root down to this keyword |
| `stats` | object | Subtree aggregates: `questionCount`, `attemptCount`, `correctCount`, `correctRate` (0–1, or null when never attempted) |

### `questions` elements

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Question ID |
| `kind` | `keyword`, `feature` | Question kind. `keyword` asks for a keyword; `feature` asks about a keyword's characteristics |
| `stem` | string | Question text |
| `explanation` | string | Explanation for the whole question |
| `keywordIds` | string array | IDs of the linked keywords |
| `status` | `active`, `disabled` | Whether the question is enabled |
| `disabledReason` | string or null | Reason for disabling |
| `updatedAt` | string | Last update timestamp |
| `choices` | array | Choices in display order. Each element has `id`, `body` (text), `explanation`, and `isCorrect` (boolean) |
| `openFlags` | array | Open (unresolved) question flags. Each element has `flag` (flag identifier), `note` (free text or null), and `createdAt` |
| `stats` | object | Per-question aggregates: `attemptCount`, `correctCount`, `correctRate` (0–1 or null), `retention` (estimated retention 0–1 or null) |

Disabled questions are never asked. Their `stats` therefore always have `attemptCount` and `correctCount` set to `0`, and `correctRate` and `retention` set to null. Use the stats only to decide which questions to fix first, and never write them into the import JSON.

### Flag identifiers

The display names are the app's Japanese labels.

| Identifier | Display name | Typical action |
| --- | --- | --- |
| `guessable` | 知識がなくても推測で解ける | Remove the clues that let the answer be guessed from the choices or the stem |
| `low_value` | 問う価値が低い | Ask about something else, or disable the question |
| `needs_explanation` | 解説の内容を追加する | Expand the explanations |
| `defective` | 問題不備（正解・問題文の誤り、正解が一つに決まらない） | Fix the error and make exactly one choice correct |
| `comment` | 疑義の内容（自由入力） | Act according to the `note` |

When a question is updated through import, the app automatically resolves its open flags.

## Import JSON

This file lists changes to the app as operations. If an operation array is omitted, it is treated as empty. Any field or operation not described here is an error.

### Root

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format` | string | required | `ai-question-study/import` |
| `version` | number | required | `1` |
| `subjectId` | string | required | Target subject ID, taken from `subject.id` of the export JSON |
| `basedOnExportedAt` | string or null | optional | `exportedAt` of the export this file was based on. Defaults to null. Targets updated after this time get a warning |
| `keywords` | object | optional | Keyword operations: arrays `add`, `rename`, `move` |
| `questions` | object | optional | Question operations: arrays `update`, `create`, `disable` |

### Keyword references

Wherever a keyword is referenced (`parent`, `keywords`), write an object with exactly one of these fields:

- `{ "id": "existing keyword ID" }`: a keyword from `keywords[].id` of the export JSON
- `{ "tempKey": "temporary key" }`: a keyword added in `keywords.add` of the same file

### Keyword operations

| Operation | Element fields | Meaning |
| --- | --- | --- |
| `add` | `tempKey` (string, required), `parent` (keyword reference or null, required), `name` (string, required) | Add a keyword. A null `parent` places it at the root |
| `rename` | `id` (string, required), `name` (string, required) | Rename an existing keyword |
| `move` | `id` (string, required), `parent` (keyword reference or null, required) | Move an existing keyword under another parent |

Siblings under the same parent cannot share a name. A move cannot create a cycle, such as moving a keyword under its own descendant.

### Question operations

| Operation | Element fields | Meaning |
| --- | --- | --- |
| `update` | `id` (string, required) plus the question content | Update an existing question. Its ID does not change |
| `create` | `tempKey` (string, optional) plus the question content | Create a new question |
| `disable` | `id` (string, required), `reason` (string or null, optional) | Disable an existing question. An empty reason is treated as null |

The question content consists of the following fields. All of them are required.

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `keyword`, `feature` | Question kind |
| `stem` | string | Question text |
| `explanation` | string | Explanation for the whole question |
| `keywords` | keyword reference array | Linked keywords (at least one) |
| `choices` | array | The complete set of choices, in display order |

Every choice element requires `body` (string), `explanation` (string), and `isCorrect` (boolean). Only choices inside `update` may also carry the `id` of an existing choice.

### Choices: full listing and IDs

- In `update`, `choices` lists every choice the question will have after the update. Existing choices that are not listed are removed
- A choice whose meaning stays the same, for example one with only reworded text, keeps its original `id`
- A choice whose meaning changes is written without an `id`, as a new choice
- Choices in `create` never have an `id`
- Choice IDs that belong to another question cannot be used

### Temporary key rules

- A `tempKey` is a name, chosen freely, for a keyword or question that is new in this file
- Keyword `tempKey` values must be unique within the file. The same applies to question `tempKey` values
- `{ "tempKey": ... }` may refer only to keywords defined in `keywords.add` of the same file. Parent–child relations between added keywords can also be written with temporary keys
- A question `tempKey` is never used as a keyword reference. It only labels the new question so the import result can report the question's new ID

### Other rules

- A keyword or question may be the target of at most one operation. Duplicates of the same operation count as more than one
- Targets must belong to the `subjectId` subject. Deleted questions cannot be targeted
- Updating a disabled question is allowed but produces a warning

### Operations the import cannot express

The import JSON has no fields for the following operations, so they cannot be written. Perform them in the app UI instead.

- Deleting keywords
- Deleting questions
- Re-enabling disabled questions
- Adding or changing subjects
- Resolving or adding question flags (the app resolves the flags of updated questions automatically)
- Writing aggregates (`stats`)

## Authoring rules

Questions in the import JSON must pass the app's authoring-rule validation. Follow these rules, and write all question content (stems, choices, explanations, keyword names, reasons) in Japanese.

- Ask about only one fact per question
  - Bad: "Which X is also Y?" Good: split it into "Which is X?" and "Which is Y?"
  - Bad: a correct answer that says "it is Y, so it is good at Z". Good: make "it is Y" and "it is good at Z" separate questions
- A question that asks for a keyword (`keyword`) normally has 6 choices. 2–4 of them are real terms; the rest are non-existent terms or terms outside the study scope
- A question that asks about a keyword's characteristics (`feature`) normally has 4 choices
- Use fewer choices only when no plausible distractors exist. Exactly one choice is always correct
- Never spell out an abbreviation in the stem or the choices. Always give the full name in an explanation
- Give an explanation for the whole question and for every choice. "わからない" ("I don't know") is a fixed choice in the UI, so never include it in the data
- Do not repeat choice text within a question

## Example

`example-import.json` is an import JSON example that uses every operation at least once. The minimal shape looks like this:

```json
{
  "format": "ai-question-study/import",
  "version": 1,
  "subjectId": "11111111-1111-4111-8111-111111111111",
  "basedOnExportedAt": "2026-11-01T09:00:00.000Z",
  "questions": {
    "disable": [{ "id": "33333333-3333-4333-8333-333333333302", "reason": "問う価値が低い" }]
  }
}
```
