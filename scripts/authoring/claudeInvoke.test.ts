import { describe, expect, it } from 'vitest';
import { buildClaudeCall, claudeInvoke, parseClaudeOutput, type Spawner } from './judgeRunner.ts';

describe('buildClaudeCall', () => {
  it('design どおりの引数・環境変数・作業ディレクトリ', () => {
    const call = buildClaudeCall('m1', 'SYS', { PATH: 'p' }, 'TMP');
    expect(call.command).toBe('claude');
    expect(call.args).toEqual([
      '-p',
      '--model',
      'm1',
      '--effort',
      'low',
      '--system-prompt',
      'SYS',
      '--tools',
      '',
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--no-session-persistence',
      '--output-format',
      'json',
    ]);
    expect(call.env).toEqual({ PATH: 'p', MAX_THINKING_TOKENS: '0', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
    expect(call.cwd).toBe('TMP');
  });
});

describe('parseClaudeOutput', () => {
  it('result と modelUsage のトークン数を取り出す', () => {
    const out = JSON.stringify({
      is_error: false,
      result: '{"surface":null}',
      modelUsage: {
        a: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 2 },
        b: { inputTokens: 1, outputTokens: 1 },
      },
    });
    expect(parseClaudeOutput(out, 0)).toEqual({
      text: '{"surface":null}',
      usage: { inputTokens: 11, outputTokens: 6, cacheReadInputTokens: 100, cacheCreationInputTokens: 2 },
    });
  });
  it('非0終了・is_error・壊れた JSON は例外', () => {
    expect(() => parseClaudeOutput('{"result":"x"}', 1)).toThrow();
    expect(() => parseClaudeOutput('{"is_error":true,"result":"bad"}', 0)).toThrow(/bad/);
    expect(() => parseClaudeOutput('not json', 0)).toThrow();
  });
});

describe('claudeInvoke', () => {
  it('プロンプトを標準入力で渡し、result を返し、使用量を通知する', async () => {
    const seen: Array<{ args: string[]; stdin: string }> = [];
    const spawner: Spawner = async (call, stdin) => {
      seen.push({ args: call.args, stdin });
      return {
        code: 0,
        stdout: JSON.stringify({ result: 'ok', modelUsage: { m: { inputTokens: 3, outputTokens: 4 } } }),
      };
    };
    const usages: number[] = [];
    const invoke = claudeInvoke('m1', { spawner, onUsage: (u) => usages.push(u.inputTokens + u.outputTokens) });
    await expect(invoke('SYS', 'こんにちは')).resolves.toBe('ok');
    expect(seen[0]!.stdin).toBe('こんにちは');
    expect(seen[0]!.args).toContain('SYS');
    expect(usages).toEqual([7]);
  });
});
