import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessageContent, microCompactMessage } from '../../lib/message-normalizer';

describe('normalizeMessageContent', () => {
  it('strips file metadata from user messages', () => {
    const raw = '<!--files:[{"id":"1","name":"test.png","filePath":"/tmp/test.png"}]-->Hello';
    const result = normalizeMessageContent('user', raw);
    assert.equal(result, 'Hello');
    assert.ok(!result.includes('files:'));
  });

  it('extracts text + tool summaries from assistant JSON', () => {
    const raw = JSON.stringify([
      { type: 'text', text: 'Here is the result:' },
      { type: 'tool_use', name: 'Read', input: { file_path: '/src/lib/db.ts' } },
    ]);
    const result = normalizeMessageContent('assistant', raw);
    assert.ok(result.includes('Here is the result:'));
    assert.ok(result.includes('(used Read:'));
  });

  it('returns "(assistant used tools)" when no text blocks', () => {
    const raw = JSON.stringify([
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
    ]);
    const result = normalizeMessageContent('assistant', raw);
    assert.ok(result.includes('used Bash'));
  });
});

describe('microCompactMessage', () => {
  it('does not truncate short content', () => {
    const content = 'Hello world';
    assert.equal(microCompactMessage('user', content, 0), content);
  });

  it('truncates long content for recent messages at 5000 chars', () => {
    const content = 'x'.repeat(10000);
    const result = microCompactMessage('user', content, 5);
    assert.ok(result.length <= 5000 + 50); // allow margin for marker
    assert.ok(result.includes('[...truncated...]'));
  });

  it('truncates more aggressively for old messages (>30 turns)', () => {
    const content = 'x'.repeat(5000);
    const result = microCompactMessage('user', content, 35);
    assert.ok(result.length <= 1000 + 50);
    assert.ok(result.includes('[...truncated...]'));
  });

  it('preserves head and tail of truncated content', () => {
    const content = 'HEAD_MARKER' + 'x'.repeat(10000) + 'TAIL_MARKER';
    const result = microCompactMessage('user', content, 5);
    assert.ok(result.startsWith('HEAD_MARKER'));
    assert.ok(result.endsWith('TAIL_MARKER'));
  });

  it('does not truncate old messages that are already short', () => {
    const content = 'Short message';
    assert.equal(microCompactMessage('user', content, 50), content);
  });
});
