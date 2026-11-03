# EARS Format Guidelines

## Overview

EARS (Easy Approach to Requirements Syntax) is the standard format for acceptance criteria in spec-driven development.

EARS patterns describe the logical structure of a requirement (condition + subject + response) and are not tied to any particular natural language.
All acceptance criteria are written entirely in the target language configured for the specification (`spec.json.language`).
For `ja`, use the fixed Japanese phrases below. Do NOT mix English EARS keywords (`When`, `If`, `While`, `Where`, `shall`) into Japanese sentences. Single English words in section headings (e.g. `Acceptance Criteria`) are acceptable.

## Primary EARS Patterns

### 1. Event-Driven Requirements

- **Pattern**: [イベント]とき、[システム]は[応答]する
- **Use Case**: Responses to specific events or triggers
- **Example**: 利用者が購入ボタンを押したとき、決済サービスはカートの内容を検証する

### 2. State-Driven Requirements

- **Pattern**: [前提状態]の間、[システム]は[応答]する
- **Use Case**: Behavior dependent on system state or preconditions
- **Example**: 決済処理中の間、決済サービスは読み込み中の表示を出す

### 3. Unwanted Behavior Requirements

- **Pattern**: [異常・望ましくない事象]場合、[システム]は[応答]する
- **Use Case**: System response to errors, failures, or undesired situations
- **Example**: 無効なカード番号が入力された場合、決済サービスはエラーメッセージを表示する

### 4. Optional Feature Requirements

- **Pattern**: [機能・構成]を含む場合、[システム]は[応答]する
- **Use Case**: Requirements for optional or conditional features
- **Example**: サンルーフを備える場合、車両はサンルーフの操作パネルを持つ

### 5. Ubiquitous Requirements

- **Pattern**: [システム]は[応答]する
- **Use Case**: Always-active requirements and fundamental system properties
- **Example**: 携帯電話の質量は100グラム未満とする

## Combined Patterns

- [前提状態]の間に[イベント]とき、[システム]は[応答]する
- [イベント]かつ[追加条件]とき、[システム]は[応答]する

## Distinguishing Event vs. Unwanted Behavior

- Use 「〜とき」 for normal events (pattern 1) and 「〜場合」 for errors or undesired situations (pattern 3), so the requirement type stays recognizable.

## Subject Selection Guidelines

- **Software Projects**: Use concrete system/service name (e.g., 「決済サービス」「認証モジュール」)
- **Process/Workflow**: Use responsible team/role
- **Non-Software**: Use appropriate subject

## Quality Criteria

- Requirements must be testable, verifiable, and describe a single behavior.
- Mandatory behavior ends with 「〜する」「〜しなければならない」; recommendations use 「〜することが望ましい」. Avoid ambiguous terms.
- Follow EARS structure: [condition]、[system]は[response]する.
