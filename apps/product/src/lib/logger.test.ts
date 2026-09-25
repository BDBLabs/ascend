import { describe, expect, it } from 'vitest';
import { redactValue } from '@/lib/logger';

describe('redactValue', () => {
  it('replaces values under secret-looking keys', () => {
    expect(redactValue({ password: 'x', apiKey: 'y', nested: { resetToken: 'z', ok: 1 } }))
      .toEqual({ password: '[redacted]', apiKey: '[redacted]', nested: { resetToken: '[redacted]', ok: 1 } });
  });

  it('scrubs bearer links, tokens, credentials and provider keys inside strings', () => {
    const scrubbed = redactValue([
      'GET /estimates/abcdefghijklmnopqrstuvwxyz0123456789ABCD failed',
      'https://x.test/reset-password?token=secret-token-value&x=1',
      'Authorization: Bearer abc.def.ghi',
      'postgresql://u:p@db.example/ascend',
      'key re_abcdefghijklmnop leaked',
    ]) as string[];
    expect(scrubbed.join('\n')).not.toMatch(/abcdefghijklmnopqrstuvwxyz0123|secret-token-value|abc\.def\.ghi|u:p@|re_abcdefghijklmnop/);
    expect(scrubbed[3]).toBe('postgresql://u:[redacted]@db.example/ascend');
    expect(scrubbed[0]).toContain('/estimates/[redacted]');
  });

  it('serialises errors without stacks and scrubs their messages', () => {
    expect(redactValue(new Error('connect postgresql://u:p@h/db'))).toEqual({
      name: 'Error', message: 'connect postgresql://u:[redacted]@h/db',
    });
  });
});
