import { describe, it, expect } from 'vitest';
import {
  sanitizeStreamChunk,
  extractStreamJsonText,
  appendLiveBuffer,
  LIVE_SUMMARY_MAX_CHARS,
} from '../bridge/stream-helpers.js';
import { describeApproval } from '../server/routes/approvals.js';

// ---------------------------------------------------------------------------
// sanitizeStreamChunk
// ---------------------------------------------------------------------------
describe('sanitizeStreamChunk', () => {
  it('strips ANSI escape codes', () => {
    expect(sanitizeStreamChunk('\x1b[32mhello\x1b[0m')).toBe('hello');
  });

  it('strips carriage returns', () => {
    expect(sanitizeStreamChunk('line\r\n')).toBe('line\n');
  });

  it('passes through plain text unchanged', () => {
    expect(sanitizeStreamChunk('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(sanitizeStreamChunk('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractStreamJsonText
// ---------------------------------------------------------------------------
describe('extractStreamJsonText', () => {
  it('returns plain text lines as-is', () => {
    expect(extractStreamJsonText('hello world')).toBe('hello world');
  });

  it('returns null for result events', () => {
    expect(extractStreamJsonText(JSON.stringify({ type: 'result' }))).toBeNull();
  });

  it('returns null for system events', () => {
    expect(extractStreamJsonText(JSON.stringify({ type: 'system' }))).toBeNull();
  });

  it('extracts text from assistant messages', () => {
    const event = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello from agent' }] },
    };
    expect(extractStreamJsonText(JSON.stringify(event))).toBe('Hello from agent');
  });

  it('returns null for assistant messages with no text content', () => {
    const event = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'x' }] },
    };
    expect(extractStreamJsonText(JSON.stringify(event))).toBeNull();
  });

  it('returns null for tool_use events', () => {
    expect(extractStreamJsonText(JSON.stringify({ type: 'tool_use' }))).toBeNull();
  });

  it('returns line as-is for invalid JSON starting with {', () => {
    expect(extractStreamJsonText('{broken json')).toBe('{broken json');
  });

  it('concatenates multiple text blocks in one assistant message', () => {
    const event = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'part1' }, { type: 'text', text: 'part2' }] },
    };
    expect(extractStreamJsonText(JSON.stringify(event))).toBe('part1part2');
  });
});

// ---------------------------------------------------------------------------
// appendLiveBuffer
// ---------------------------------------------------------------------------
describe('appendLiveBuffer', () => {
  it('appends chunk to empty buffer', () => {
    expect(appendLiveBuffer('', 'hello')).toBe('hello');
  });

  it('appends chunk to non-empty buffer', () => {
    expect(appendLiveBuffer('existing ', 'chunk')).toBe('existing chunk');
  });

  it('truncates to LIVE_SUMMARY_MAX_CHARS when overflow', () => {
    const big = 'x'.repeat(LIVE_SUMMARY_MAX_CHARS + 100);
    const result = appendLiveBuffer('', big);
    expect(result.length).toBe(LIVE_SUMMARY_MAX_CHARS);
  });

  it('keeps the TAIL of the buffer when truncating', () => {
    const existing = 'A'.repeat(LIVE_SUMMARY_MAX_CHARS - 5);
    const chunk = 'BBBBB';
    const result = appendLiveBuffer(existing, chunk);
    expect(result.length).toBe(LIVE_SUMMARY_MAX_CHARS);
    expect(result.endsWith('BBBBB')).toBe(true);
  });

  it('does not truncate when within limit', () => {
    const result = appendLiveBuffer('hello', ' world');
    expect(result).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// describeApproval
// ---------------------------------------------------------------------------
describe('describeApproval', () => {
  it('describes hire_agent approval', () => {
    const desc = describeApproval('hire_agent', { slug: 'reviewer', model: 'claude-3.5-sonnet' });
    expect(desc).toContain('reviewer');
    expect(desc).toContain('claude-3.5-sonnet');
  });

  it('describes budget_override approval', () => {
    const desc = describeApproval('budget_override', { agentSlug: 'builder' });
    expect(desc).toContain('builder');
  });

  it('describes ceo_strategy approval', () => {
    const desc = describeApproval('ceo_strategy', {});
    expect(desc).toContain('CEO');
  });

  it('handles unknown approval types gracefully', () => {
    const desc = describeApproval('unknown_type', {});
    expect(desc).toContain('unknown_type');
  });

  it('handles missing metadata fields', () => {
    const desc = describeApproval('hire_agent', {});
    expect(desc).toContain('?');
  });
});
