import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const outbox = vi.hoisted(() => ({
  claim: vi.fn(),
  finish: vi.fn(),
}));

vi.mock('@/lib/transactional-outbox', () => ({
  claimOutboxMessages: outbox.claim,
  finishOutboxMessage: outbox.finish,
}));

import {
  buildEstimateDeliveryEmail,
  dispatchOutboxMessage,
  dispatchOutboxMessages,
  finishWithRetry,
  isResendConfigured,
  OutboxDispatchError,
  type EstimateDeliveryPayload,
} from '@/lib/outbox-dispatch';
import type { OutboxMessage } from '@/lib/transactional-outbox';

const VALID_PAYLOAD: EstimateDeliveryPayload = {
  displayId: 'EST-0001',
  customerEmail: 'customer@example.com',
  from: 'Paris Electric <hello@paris.useascend.com>',
  companyName: 'Paris Electric',
  timeZone: 'America/New_York',
  expiresAt: '2026-09-01T00:00:00.000Z',
  viewUrl: 'https://paris.useascend.com/documents/estimates/aaa',
  approveUrl: 'https://paris.useascend.com/documents/estimates/bbb',
  declineUrl: 'https://paris.useascend.com/documents/estimates/ccc',
};

function message(payload: unknown, key = 'idem-1'): OutboxMessage {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    topic: 'estimate_delivery',
    key,
    payload: payload as Record<string, unknown>,
    attempts: 1,
    claimToken: '33333333-3333-4333-8333-333333333333',
  };
}

function okFetch() {
  return async () => (new Response(JSON.stringify({ id: 'resend-message-id' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }) as Response);
}

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

describe('buildEstimateDeliveryEmail', () => {
  it('builds subject, text, and html with the document links', () => {
    const email = buildEstimateDeliveryEmail({
      companyName: 'Paris Electric',
      displayId: 'EST-0001',
      expiresAt: '2026-09-01T00:00:00.000Z',
      timeZone: 'America/New_York',
      viewUrl: 'https://paris.useascend.com/view',
      approveUrl: 'https://paris.useascend.com/approve',
      declineUrl: 'https://paris.useascend.com/decline',
    });
    expect(email.subject).toBe('EST-0001 from Paris Electric');
    expect(email.text).toContain('https://paris.useascend.com/view');
    expect(email.text).toContain('https://paris.useascend.com/approve');
    expect(email.text).toContain('https://paris.useascend.com/decline');
    expect(email.html).toContain('Review estimate');
    expect(email.html).toContain('Approve this estimate');
    expect(email.html).toContain('Decline this estimate');
  });

  it('escapes company and display id content in html', () => {
    const email = buildEstimateDeliveryEmail({
      companyName: '<script>alert(1)</script>',
      displayId: 'EST & 1',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      timeZone: 'UTC',
      viewUrl: 'https://paris.useascend.com/v',
      approveUrl: 'https://paris.useascend.com/a',
      declineUrl: 'https://paris.useascend.com/d',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('EST &amp; 1');
  });
});

describe('isResendConfigured', () => {
  it('is false when the key is unset', () => {
    expect(isResendConfigured()).toBe(false);
  });

  it('is false for a key without the re_ prefix', () => {
    process.env.RESEND_API_KEY = 'sk_live_abcdefghijkl';
    expect(isResendConfigured()).toBe(false);
  });

  it('is false for a too-short key', () => {
    process.env.RESEND_API_KEY = 're_short';
    expect(isResendConfigured()).toBe(false);
  });

  it('is true for a real-looking key', () => {
    process.env.RESEND_API_KEY = 're_test_abcdefghijkl';
    expect(isResendConfigured()).toBe(true);
  });
});

describe('dispatchOutboxMessage', () => {
  it('sends an estimate delivery email through the provider', async () => {
    process.env.RESEND_API_KEY = 're_test_abcdefghijkl';
    let sentBody: Record<string, unknown> | null = null;
    let idempotencyKey: string | null = null;
    const fetchImplementation = (async (_url: string, init?: RequestInit) => {
      idempotencyKey = (init?.headers as Record<string, string>)['Idempotency-Key'];
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'resend-message-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await dispatchOutboxMessage(message(VALID_PAYLOAD, 'idem-42'), fetchImplementation);

    expect(sentBody).toMatchObject({
      from: 'Paris Electric <hello@paris.useascend.com>',
      to: ['customer@example.com'],
      subject: 'EST-0001 from Paris Electric',
    });
    expect(sentBody?.text).toContain('https://paris.useascend.com/documents/estimates/aaa');
    expect(idempotencyKey).toBe('idem-42');
  });

  it('rejects an unknown topic without sending', async () => {
    const fetchImplementation = okFetch();
    const unknown = { ...message(VALID_PAYLOAD), topic: 'invoice_delivery' };
    await expect(dispatchOutboxMessage(unknown, fetchImplementation))
      .rejects.toMatchObject({ code: 'unknown_topic', retryable: false });
  });

  it('rejects a malformed payload without sending', async () => {
    process.env.RESEND_API_KEY = 're_test_abcdefghijkl';
    const malformed = message({ displayId: 'EST-0001' });
    await expect(dispatchOutboxMessage(malformed, okFetch()))
      .rejects.toMatchObject({ code: 'invalid_payload', retryable: false });
  });

  it('maps provider 4xx/5xx into a non-retryable/retryable error', async () => {
    process.env.RESEND_API_KEY = 're_test_abcdefghijkl';
    const fetchImplementation = async () => new Response('rate limited', {
      status: 429,
    }) as Response;
    await expect(dispatchOutboxMessage(message(VALID_PAYLOAD), fetchImplementation))
      .rejects.toMatchObject({ code: 'provider_rate_limit', retryable: true });
  });

  it('fails closed when Resend is not configured', async () => {
    const error = await dispatchOutboxMessage(message(VALID_PAYLOAD), okFetch())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OutboxDispatchError);
    expect((error as OutboxDispatchError).code).toBe('delivery_not_configured');
  });
});

describe('finishWithRetry', () => {
  const claim = { id: 'id-1', claimToken: 'token-1' };

  it('succeeds on the first attempt', async () => {
    const finish = async () => true;
    await expect(finishWithRetry(claim, { succeeded: true }, finish)).resolves.toBe(true);
  });

  it('retries a transient failure and eventually succeeds', async () => {
    let calls = 0;
    const finish = async () => {
      calls += 1;
      if (calls < 3) throw new Error('connection reset');
      return true;
    };
    await finishWithRetry(claim, { succeeded: true }, finish);
    expect(calls).toBe(3);
  });

  it('gives up and rethrows after exhausting retries', async () => {
    let calls = 0;
    const finish = async (): Promise<boolean> => {
      calls += 1;
      throw new Error('db down');
    };
    await expect(finishWithRetry(claim, { succeeded: false, retryable: false, error: 'provider_rejected' }, finish))
      .rejects.toThrow('db down');
    expect(calls).toBe(3);
  });

  it('does not retry a lost claim', async () => {
    let calls = 0;
    const finish = async () => {
      calls += 1;
      return false;
    };
    await expect(finishWithRetry(claim, { succeeded: true }, finish)).resolves.toBe(false);
    expect(calls).toBe(1);
  });
});

describe('dispatchOutboxMessages (drain loop)', () => {
  beforeEach(() => {
    outbox.claim.mockReset();
    outbox.finish.mockReset();
    outbox.finish.mockResolvedValue(true);
    process.env.RESEND_API_KEY = 're_test_key_123456';
  });

  function batch(size: number, offset = 0): OutboxMessage[] {
    return Array.from({ length: size }, (_, index) => ({
      ...message(VALID_PAYLOAD, `idem-${offset + index}`),
      id: `id-${offset + index}`,
    }));
  }

  it('stops as soon as a batch comes back short', async () => {
    outbox.claim.mockResolvedValueOnce(batch(2));
    const summary = await dispatchOutboxMessages({ limit: 5, fetchImplementation: okFetch() });
    expect(outbox.claim).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ claimed: 2, delivered: 2, failed: 0, batches: 1, budgetExhausted: false });
  });

  it('drains several full batches, bounded by maxBatches', async () => {
    outbox.claim.mockImplementation(async (limit: number) => batch(limit));
    const summary = await dispatchOutboxMessages({ limit: 3, maxBatches: 4, fetchImplementation: okFetch() });
    expect(outbox.claim).toHaveBeenCalledTimes(4);
    expect(summary).toMatchObject({ claimed: 12, delivered: 12, batches: 4, budgetExhausted: true });
  });

  it('stops on the time budget before claiming more work', async () => {
    let clock = 0;
    outbox.claim.mockImplementation(async (limit: number) => {
      clock += 1000;
      return batch(limit);
    });
    const summary = await dispatchOutboxMessages({
      limit: 1, budgetMs: 2500, now: () => clock, fetchImplementation: okFetch(),
    });
    expect(summary.batches).toBe(3);
    expect(summary.budgetExhausted).toBe(true);
  });

  it('passes terminal provider errors through as non-retryable', async () => {
    outbox.claim.mockResolvedValueOnce(batch(1));
    const rejecting = async () => new Response('{}', { status: 422 });
    const summary = await dispatchOutboxMessages({ limit: 5, fetchImplementation: rejecting as typeof fetch });
    expect(summary.failed).toBe(1);
    expect(outbox.finish).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'id-0', claimToken: '33333333-3333-4333-8333-333333333333' }),
      { succeeded: false, retryable: false, error: 'provider_rejected' },
    );
  });

  it('marks rate limits retryable', async () => {
    outbox.claim.mockResolvedValueOnce(batch(1));
    const limited = async () => new Response('{}', { status: 429 });
    await dispatchOutboxMessages({ limit: 5, fetchImplementation: limited as typeof fetch });
    expect(outbox.finish).toHaveBeenCalledWith(
      expect.anything(),
      { succeeded: false, retryable: true, error: 'provider_rate_limit' },
    );
  });

  it('counts a lost claim as unrecorded without failing the run', async () => {
    outbox.claim.mockResolvedValueOnce(batch(1));
    outbox.finish.mockResolvedValue(false);
    const summary = await dispatchOutboxMessages({ limit: 5, fetchImplementation: okFetch() });
    expect(summary).toMatchObject({ delivered: 1, unrecorded: 1 });
  });

  it('sends the stable outbox key as the provider idempotency key', async () => {
    outbox.claim.mockResolvedValueOnce(batch(1));
    const seen: string[] = [];
    const capture = async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
      return okFetch()();
    };
    await dispatchOutboxMessages({ limit: 5, fetchImplementation: capture as unknown as typeof fetch });
    expect(seen).toEqual(['idem-0']);
  });
});
